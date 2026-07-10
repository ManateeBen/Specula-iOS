import { v4 as uuidv4 } from 'uuid'
import JSZip from 'jszip'
import * as pdfjs from 'pdfjs-dist'
import { Preferences } from '@capacitor/preferences'
import {
  readBinaryFile,
  writeBinaryFile,
  deleteFile,
  fileExists,
  pickBookFile,
  readFileAsUint8Array,
  getExt,
  BOOKS_DIR,
  COVERS_DIR,
} from './storage'
import { getBooksDir, getCoversDir, runSql, runMany, queryAll, queryOne } from './db'
import type { Book, Chapter, BookFormat, PdfTextStatus } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).toString()

const SAMPLE_BOOKS_SEEDED_KEY = 'specula_sample_books_seeded_v1'
const SAMPLE_BOOKS = [
  {
    key: 'specula-getting-started',
    fileName: 'Specula_Getting_Started.epub',
    assetPath: 'sample-books/Specula_Getting_Started.epub',
  },
] as const

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml')
}

function elsByLocal(node: ParentNode, local: string): Element[] {
  const all = node.getElementsByTagName('*')
  const out: Element[] = []
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    const tn = el.tagName || ''
    if (el.localName === local || tn === local || tn.endsWith(':' + local)) {
      out.push(el)
    }
  }
  return out
}

function xmlText(els: Element[]): string {
  return els[0]?.textContent?.trim() || ''
}

function resolveZipPath(dir: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0])
  const parts = (dir ? dir.split('/') : []).concat(clean.split('/'))
  const stack: string[] = []
  for (const p of parts) {
    if (p === '.' || p === '') continue
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  return stack.join('/')
}

function extractBodyText(doc: Document): string {
  const body = elsByLocal(doc, 'body')[0] || doc.documentElement
  let text = ''
  const blocks = new Set(['p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'section'])
  const walk = (n: Node | null) => {
    if (!n) return
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.nodeValue || ''
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element
      const tag = (el.tagName || '').toLowerCase()
      if (tag === 'script' || tag === 'style') return
      for (let c = el.firstChild; c; c = c.nextSibling) walk(c)
      if (blocks.has(tag)) text += '\n'
    }
  }
  walk(body)
  return text.replace(/[ \t]+/g, ' ').replace(/\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function extractEpubHrefText(zip: JSZip, opfDir: string, href: string): Promise<string> {
  try {
    const zipPath = resolveZipPath(opfDir, href)
    const file = zip.file(zipPath)
    if (!file) return ''
    return extractBodyText(parseXml(await file.async('string')))
  } catch {
    return ''
  }
}

function normalizeReadableText(text: string): string {
  return text.replace(/\s+/g, '')
}

async function loadEpubZip(filePath: string): Promise<JSZip> {
  const data = await readBinaryFile(filePath)
  return JSZip.loadAsync(data)
}

interface OpfContext {
  opfDir: string
  opf: Document
  zip: JSZip
}

async function getOpfContext(zip: JSZip): Promise<OpfContext> {
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('无效的 EPUB：缺少 container.xml')
  const container = parseXml(await containerFile.async('string'))
  const opfPath = elsByLocal(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('无效的 EPUB：找不到 OPF 文件')
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('无效的 EPUB：OPF 文件不存在')
  const opf = parseXml(await opfFile.async('string'))
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  return { opfDir, opf, zip }
}

interface BookRow {
  id: string
  title: string
  author: string
  format: BookFormat
  file_path: string
  cover_path: string | null
  pdf_text_status: PdfTextStatus | null
  pdf_ai_unsupported_reason: string | null
  created_at: string
}

interface ChapterRow {
  id: string
  book_id: string
  title: string
  order_index: number
  start_ref: string
  end_ref: string
}

function rowToBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format,
    filePath: row.file_path,
    coverPath: row.cover_path,
    pdfTextStatus: row.pdf_text_status ?? null,
    pdfAiUnsupportedReason: row.pdf_ai_unsupported_reason ?? null,
    createdAt: row.created_at,
  }
}

function rowToChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    orderIndex: row.order_index,
    startRef: row.start_ref,
    endRef: row.end_ref,
  }
}

async function parseEpubMetadata(filePath: string, fallbackName: string): Promise<{
  title: string
  author: string
  coverPath: string | null
  chapters: Omit<Chapter, 'id' | 'bookId'>[]
}> {
  const zip = await loadEpubZip(filePath)
  const { opfDir, opf } = await getOpfContext(zip)

  const title = xmlText(elsByLocal(opf, 'title')) || fallbackName.replace(/\.epub$/i, '')
  const author = xmlText(elsByLocal(opf, 'creator'))

  const manifest = new Map<string, { href: string; type: string; props: string }>()
  for (const item of elsByLocal(opf, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) {
      manifest.set(id, {
        href,
        type: item.getAttribute('media-type') || '',
        props: item.getAttribute('properties') || '',
      })
    }
  }

  const toOpfRelative = (fileDir: string, href: string): string => {
    const full = resolveZipPath(fileDir, href)
    return opfDir && full.startsWith(opfDir + '/') ? full.slice(opfDir.length + 1) : full
  }

  let toc: { label: string; href: string }[] = []
  const spineEl = elsByLocal(opf, 'spine')[0]
  const ncxId = spineEl?.getAttribute('toc')
  const ncxEntry = ncxId ? manifest.get(ncxId) : undefined
  if (ncxEntry) {
    const ncxPath = resolveZipPath(opfDir, ncxEntry.href)
    const ncxFile = zip.file(ncxPath)
    if (ncxFile) {
      const ncxDir = ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/')) : ''
      const ncx = parseXml(await ncxFile.async('string'))
      toc = elsByLocal(ncx, 'navPoint').map((np) => ({
        label: xmlText(elsByLocal(np, 'text')),
        href: toOpfRelative(ncxDir, elsByLocal(np, 'content')[0]?.getAttribute('src') || ''),
      }))
    }
  }
  if (toc.length === 0) {
    const navEntry = [...manifest.values()].find((m) => m.props.includes('nav'))
    if (navEntry) {
      const navPath = resolveZipPath(opfDir, navEntry.href)
      const navFile = zip.file(navPath)
      if (navFile) {
        const navDir = navPath.includes('/') ? navPath.slice(0, navPath.lastIndexOf('/')) : ''
        const navDoc = parseXml(await navFile.async('string'))
        const navs = elsByLocal(navDoc, 'nav')
        const tocNav =
          navs.find((n) =>
            ((n.getAttribute('epub:type') || n.getAttribute('type') || '')).includes('toc')
          ) || navs[0]
        if (tocNav) {
          toc = elsByLocal(tocNav, 'a').map((a) => ({
            label: a.textContent?.trim() || '',
            href: toOpfRelative(navDir, a.getAttribute('href') || ''),
          }))
        }
      }
    }
  }
  if (toc.length === 0) {
    const spineHrefs = elsByLocal(opf, 'itemref')
      .map((r) => manifest.get(r.getAttribute('idref') || '')?.href)
      .filter((h): h is string => !!h)
    toc = spineHrefs.map((href, i) => ({ label: `第 ${i + 1} 章`, href: href.split('#')[0] }))
  }

  let chapters: Omit<Chapter, 'id' | 'bookId'>[] = toc.map((item, index) => ({
    title: item.label || `章节 ${index + 1}`,
    orderIndex: index,
    startRef: item.href.split('#')[0],
    endRef: item.href.split('#')[0],
  }))

  while (chapters.length > 1) {
    const first = chapters[0]
    const text = await extractEpubHrefText(zip, opfDir, first.startRef)
    if (normalizeReadableText(text).length >= 80) break
    chapters = chapters.slice(1).map((chapter, index) => ({ ...chapter, orderIndex: index }))
  }

  let coverPath: string | null = null
  try {
    let coverHref = [...manifest.values()].find((m) => m.props.includes('cover-image'))?.href
    if (!coverHref) {
      const coverMeta = elsByLocal(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')
      const coverId = coverMeta?.getAttribute('content')
      if (coverId) coverHref = manifest.get(coverId)?.href
    }
    if (coverHref) {
      const coverZipPath = resolveZipPath(opfDir, coverHref)
      const coverFile = zip.file(coverZipPath)
      if (coverFile) {
        const ext = getExt(coverZipPath) || '.jpg'
        coverPath = `${getCoversDir()}/${uuidv4()}${ext}`
        const coverData = await coverFile.async('uint8array')
        await writeBinaryFile(coverPath, coverData)
      }
    }
  } catch {
    // cover optional
  }

  return { title, author, coverPath, chapters }
}

const PDF_SAMPLE_PAGES = 5
const PDF_TEXT_PAGE_MIN_CHARS = 80
const PDF_EMPTY_PAGE_MAX_CHARS = 20
const PDF_TEXT_PAGE_RATIO_THRESHOLD = 0.6

function getPdfUnsupportedReason(status: PdfTextStatus): string | null {
  if (status === 'scan') return '扫描型 PDF 暂不支持 AI 解释、章节测验和薄弱点分析，开发中'
  if (status === 'mixed') return '混合型 PDF 暂不支持 AI 解释、章节测验和薄弱点分析，开发中'
  if (status === 'unknown') return '该 PDF 尚未完成文本检测，请重新导入后使用 AI 功能'
  return null
}

function getPdfSamplePages(totalPages: number): number[] {
  const sampleCount = Math.min(PDF_SAMPLE_PAGES, totalPages)
  if (sampleCount <= 0) return []
  if (sampleCount === 1) return [1]

  const pages = new Set<number>()
  for (let i = 0; i < sampleCount; i++) {
    pages.add(Math.max(1, Math.min(totalPages, Math.round(1 + ((totalPages - 1) * i) / (sampleCount - 1)))))
  }
  return [...pages].sort((a, b) => a - b)
}

async function detectPdfTextStatus(doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>): Promise<PdfTextStatus> {
  const samplePages = getPdfSamplePages(doc.numPages)
  if (samplePages.length === 0) return 'scan'

  let textPages = 0
  let emptyPages = 0
  let weakPages = 0

  for (const pageNumber of samplePages) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('')
      .replace(/\s+/g, '')

    if (text.length >= PDF_TEXT_PAGE_MIN_CHARS) textPages += 1
    else if (text.length <= PDF_EMPTY_PAGE_MAX_CHARS) emptyPages += 1
    else weakPages += 1
  }

  if (textPages === 0) return 'scan'
  if (textPages / samplePages.length >= PDF_TEXT_PAGE_RATIO_THRESHOLD) return 'text'
  if (emptyPages > 0 || weakPages > 0) return 'mixed'
  return 'mixed'
}

async function parsePdfMetadata(filePath: string, fallbackName: string): Promise<{
  title: string
  author: string
  coverPath: string | null
  pdfTextStatus: PdfTextStatus
  pdfAiUnsupportedReason: string | null
  chapters: Omit<Chapter, 'id' | 'bookId'>[]
}> {
  const data = await readBinaryFile(filePath)
  const doc = await pdfjs.getDocument({ data }).promise
  const pdfTextStatus = await detectPdfTextStatus(doc)

  const metadata = await doc.getMetadata().catch(() => ({ info: {} }))
  const info = (metadata as { info?: Record<string, string> }).info || {}
  const title = info.Title || fallbackName.replace(/\.pdf$/i, '')
  const author = info.Author || ''
  const numPages = doc.numPages

  const chapters: Omit<Chapter, 'id' | 'bookId'>[] = []
  const pagesPerChapter = 20

  try {
    const outline = await doc.getOutline()
    if (outline && outline.length > 0) {
      const flat: { title: string; dest: unknown }[] = []
      const flattenOutline = (items: typeof outline) => {
        for (const item of items) {
          flat.push({ title: item.title, dest: item.dest })
          if (item.items?.length) flattenOutline(item.items)
        }
      }
      flattenOutline(outline)

      const resolvePage = async (dest: unknown): Promise<number | null> => {
        try {
          let explicit = dest
          if (typeof dest === 'string') {
            explicit = await doc.getDestination(dest)
          }
          if (!Array.isArray(explicit) || !explicit[0]) return null
          const pageIndex = await doc.getPageIndex(explicit[0])
          return pageIndex + 1
        } catch {
          return null
        }
      }

      const withPages: { title: string; page: number }[] = []
      for (const it of flat) {
        const resolved = await resolvePage(it.dest)
        const page = resolved ?? (withPages.length ? withPages[withPages.length - 1].page : 1)
        withPages.push({ title: it.title, page })
      }

      withPages.forEach((wp, i) => {
        const start = wp.page
        let end = numPages
        for (let j = i + 1; j < withPages.length; j++) {
          if (withPages[j].page > start) {
            end = withPages[j].page - 1
            break
          }
        }
        if (end < start) end = start
        chapters.push({
          title: wp.title || `章节 ${i + 1}`,
          orderIndex: i,
          startRef: String(start),
          endRef: String(end),
        })
      })
    }
  } catch {
    // no outline
  }

  if (chapters.length === 0) {
    for (let i = 0; i < numPages; i += pagesPerChapter) {
      const start = i + 1
      const end = Math.min(i + pagesPerChapter, numPages)
      chapters.push({
        title: `第 ${start}-${end} 页`,
        orderIndex: chapters.length,
        startRef: String(start),
        endRef: String(end),
      })
    }
  }

  return {
    title,
    author,
    coverPath: null,
    pdfTextStatus,
    pdfAiUnsupportedReason: getPdfUnsupportedReason(pdfTextStatus),
    chapters,
  }
}

export async function importBook(): Promise<Book | null> {
  const file = await pickBookFile()
  if (!file) return null

  const fileData = await readFileAsUint8Array(file)
  return importBookData(fileData, file.name)
}

export async function importBookFromStoragePath(filePath: string, originalName?: string): Promise<Book | null> {
  const fileData = await readBinaryFile(filePath)
  try {
    return await importBookData(fileData, originalName || filePath.split('/').pop() || 'book')
  } finally {
    if (filePath.startsWith('ExternalImports/')) {
      await deleteFile(filePath)
    }
  }
}

async function readBundledAsset(assetPath: string): Promise<Uint8Array> {
  const base = import.meta.env.BASE_URL || './'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const response = await fetch(`${normalizedBase}${assetPath}`)
  if (!response.ok) {
    throw new Error(`无法读取内置书籍：${assetPath}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function importBookData(fileData: Uint8Array, fileName: string): Promise<Book> {
  const name = fileName.toLowerCase()
  if (!name.endsWith('.epub') && !name.endsWith('.pdf')) {
    throw new Error('仅支持导入 EPUB 或 PDF 文件')
  }

  const format: BookFormat = name.endsWith('.epub') ? 'epub' : 'pdf'
  const ext = format === 'epub' ? '.epub' : '.pdf'

  const bookId = uuidv4()
  const destPath = `${getBooksDir()}/${bookId}${ext}`
  await writeBinaryFile(destPath, fileData)

  const parsed = format === 'epub'
    ? await parseEpubMetadata(destPath, fileName)
    : await parsePdfMetadata(destPath, fileName)
  const meta = {
    ...parsed,
    pdfTextStatus: format === 'pdf' && 'pdfTextStatus' in parsed ? parsed.pdfTextStatus : null,
    pdfAiUnsupportedReason:
      format === 'pdf' && 'pdfAiUnsupportedReason' in parsed ? parsed.pdfAiUnsupportedReason : null,
  }

  const statements: { sql: string; params: unknown[] }[] = [
    {
      sql: `INSERT INTO books (id, title, author, format, file_path, cover_path, pdf_text_status, pdf_ai_unsupported_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        bookId,
        meta.title,
        meta.author,
        format,
        destPath,
        meta.coverPath,
        meta.pdfTextStatus,
        meta.pdfAiUnsupportedReason,
      ],
    },
  ]
  for (const ch of meta.chapters) {
    statements.push({
      sql: `INSERT INTO chapters (id, book_id, title, order_index, start_ref, end_ref) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [uuidv4(), bookId, ch.title, ch.orderIndex, ch.startRef, ch.endRef],
    })
  }
  statements.push({
    sql: `INSERT INTO reading_progress (book_id, chapter_id, position) VALUES (?, ?, ?)`,
    params: [bookId, null, ''],
  })
  runMany(statements)

  const row = queryOne<BookRow>('SELECT * FROM books WHERE id = ?', [bookId])
  if (!row) throw new Error('导入书籍失败')
  return rowToBook(row)
}

export async function seedSampleBooks(): Promise<void> {
  const seeded = await Preferences.get({ key: SAMPLE_BOOKS_SEEDED_KEY })
  if (seeded.value === '1') return

  for (const sample of SAMPLE_BOOKS) {
    const existing = queryOne<BookRow>('SELECT * FROM books WHERE title = ?', ['Specula Getting Started'])
    if (existing) continue

    const data = await readBundledAsset(sample.assetPath)
    await importBookData(data, sample.fileName)
  }

  await Preferences.set({ key: SAMPLE_BOOKS_SEEDED_KEY, value: '1' })
}

export function listBooks(): Book[] {
  const rows = queryAll<BookRow>('SELECT * FROM books ORDER BY created_at DESC')
  return rows.map(rowToBook)
}

export function getBook(id: string): Book | null {
  const row = queryOne<BookRow>('SELECT * FROM books WHERE id = ?', [id])
  return row ? rowToBook(row) : null
}

export async function getFileData(bookId: string): Promise<Uint8Array> {
  const book = getBook(bookId)
  if (!book || !(await fileExists(book.filePath))) {
    throw new Error('书籍文件不存在')
  }
  return readBinaryFile(book.filePath)
}

export async function deleteBook(id: string): Promise<void> {
  const book = getBook(id)
  if (book) {
    if (await fileExists(book.filePath)) await deleteFile(book.filePath)
    if (book.coverPath && (await fileExists(book.coverPath))) await deleteFile(book.coverPath)
  }
  runSql('DELETE FROM books WHERE id = ?', [id])
}

export function listChapters(bookId: string): Chapter[] {
  const rows = queryAll<ChapterRow>(
    'SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index',
    [bookId]
  )
  return rows.map(rowToChapter)
}

export async function getChapterContent(chapterId: string): Promise<string> {
  const chapter = queryOne<ChapterRow>('SELECT * FROM chapters WHERE id = ?', [chapterId])
  if (!chapter) return ''

  const book = queryOne<BookRow>('SELECT * FROM books WHERE id = ?', [chapter.book_id])
  if (!book) return ''

  if (book.format === 'epub') {
    return extractEpubChapterText(book.file_path, chapter.start_ref)
  }
  return extractPdfChapterText(book.file_path, chapter.start_ref, chapter.end_ref)
}

async function extractEpubChapterText(filePath: string, href: string): Promise<string> {
  try {
    const zip = await loadEpubZip(filePath)
    const { opfDir } = await getOpfContext(zip)
    const zipPath = resolveZipPath(opfDir, href)
    const file = zip.file(zipPath)
    if (!file) return ''
    const doc = parseXml(await file.async('string'))
    return extractBodyText(doc)
  } catch {
    return ''
  }
}

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

function sanitizeEpubBody(body: Element): void {
  let nestedBody = elsByLocal(body, 'body')[0]
  while (nestedBody) {
    const parent = nestedBody.parentNode
    if (!parent) break
    while (nestedBody.firstChild) parent.insertBefore(nestedBody.firstChild, nestedBody)
    parent.removeChild(nestedBody)
    nestedBody = elsByLocal(body, 'body')[0]
  }

  for (const tag of ['head', 'style', 'script', 'link', 'meta', 'title']) {
    for (const el of elsByLocal(body, tag)) el.remove()
  }
}

export async function getEpubChapterHtml(bookId: string, href: string): Promise<string> {
  const book = getBook(bookId)
  if (!book) return ''
  try {
    const zip = await loadEpubZip(book.filePath)
    const { opfDir } = await getOpfContext(zip)
    const chapterPath = resolveZipPath(opfDir, href)
    const file = zip.file(chapterPath)
    if (!file) return ''
    const doc = parseXml(await file.async('string'))
    const chapterDir = chapterPath.includes('/') ? chapterPath.slice(0, chapterPath.lastIndexOf('/')) : ''
    const body = elsByLocal(doc, 'body')[0]
    if (!body) return ''

    sanitizeEpubBody(body)

    const imgs = [...elsByLocal(body, 'img'), ...elsByLocal(body, 'image')]
    for (const img of imgs) {
      const attr = img.getAttribute('src')
        ? 'src'
        : img.getAttribute('xlink:href')
          ? 'xlink:href'
          : img.getAttribute('href')
            ? 'href'
            : null
      if (!attr) continue
      const src = img.getAttribute(attr) || ''
      if (!src || src.startsWith('data:')) continue
      const imgFile = zip.file(resolveZipPath(chapterDir, src))
      if (!imgFile) continue
      const ext = getExt(src.split('#')[0]).toLowerCase()
      const mime = IMG_MIME[ext] || 'image/png'
      img.setAttribute(attr, `data:${mime};base64,${await imgFile.async('base64')}`)
    }

    const serializer = new XMLSerializer()
    let html = ''
    for (let c = body.firstChild; c; c = c.nextSibling) {
      html += serializer.serializeToString(c)
    }
    return html
  } catch {
    return ''
  }
}

async function extractPdfChapterText(filePath: string, startRef: string, endRef: string): Promise<string> {
  const data = await readBinaryFile(filePath)
  const doc = await pdfjs.getDocument({ data }).promise

  const startPage = parseInt(startRef, 10) || 1
  const endPage = parseInt(endRef, 10) || startPage
  const texts: string[] = []

  for (let i = startPage; i <= endPage && i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    texts.push(pageText)
  }

  return texts.join('\n\n').trim()
}

export function saveProgress(bookId: string, chapterId: string | null, position: string): void {
  runSql(
    `INSERT INTO reading_progress (book_id, chapter_id, position, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(book_id) DO UPDATE SET
       chapter_id = excluded.chapter_id,
       position = excluded.position,
       updated_at = datetime('now')`,
    [bookId, chapterId, position]
  )
}

export function getProgress(bookId: string): {
  bookId: string
  chapterId: string | null
  position: string
  updatedAt: string
} | null {
  const row = queryOne<{
    book_id: string
    chapter_id: string | null
    position: string
    updated_at: string
  }>('SELECT * FROM reading_progress WHERE book_id = ?', [bookId])
  if (!row) return null
  return {
    bookId: row.book_id,
    chapterId: row.chapter_id,
    position: row.position,
    updatedAt: row.updated_at,
  }
}

export function listHighlights(bookId: string) {
  return queryAll<{
    id: string
    book_id: string
    chapter_id: string | null
    selected_text: string
    context: string
    ai_explanation: string | null
    teaching_mode: string | null
    source: string
    weak_point_topic: string | null
    weak_point_index: number | null
    created_at: string
  }>('SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at DESC', [bookId])
}

export function createHighlight(data: {
  bookId: string
  chapterId: string | null
  selectedText: string
  context: string
  aiExplanation: string | null
  teachingMode: string | null
  source?: string
  weakPointTopic?: string | null
}) {
  const id = uuidv4()
  runSql(
    `INSERT INTO highlights (id, book_id, chapter_id, selected_text, context, ai_explanation, teaching_mode, source, weak_point_topic)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.bookId, data.chapterId, data.selectedText, data.context, data.aiExplanation, data.teachingMode, data.source || 'user', data.weakPointTopic || null]
  )
  return id
}

export function createHighlightsFromWeakPoints(data: {
  bookId: string
  chapterId: string
  weakPoints: import('../types').WeakPoint[]
}) {
  const results: {
    id: string
    bookId: string
    chapterId: string | null
    selectedText: string
    context: string
    aiExplanation: string | null
    teachingMode: string | null
    source: string
    weakPointTopic: string | null
    weakPointIndex: number | null
    createdAt: string
  }[] = []

  const statements: { sql: string; params: unknown[] }[] = []
  data.weakPoints.forEach((wp, i) => {
    const id = uuidv4()
    const wpIndex = i + 1
    const selectedText = wp.sourceExcerpt || wp.topic
    const aiExplanation = `${wp.reason}\n\n${wp.miniLesson}`
    statements.push({
      sql: `INSERT INTO highlights (id, book_id, chapter_id, selected_text, context, ai_explanation, teaching_mode, source, weak_point_topic, weak_point_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, data.bookId, data.chapterId, selectedText, wp.reason, aiExplanation, null, 'quiz', wp.topic, wpIndex],
    })
    results.push({
      id,
      bookId: data.bookId,
      chapterId: data.chapterId,
      selectedText,
      context: wp.reason,
      aiExplanation,
      teachingMode: null,
      source: 'quiz',
      weakPointTopic: wp.topic,
      weakPointIndex: wpIndex,
      createdAt: new Date().toISOString(),
    })
  })
  if (statements.length > 0) runMany(statements)
  return results
}

export function deleteHighlight(id: string): void {
  runSql('DELETE FROM highlights WHERE id = ?', [id])
}
