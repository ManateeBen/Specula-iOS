import { useEffect, useRef, useState, useMemo } from 'react'
import { Check, Copy, Highlighter, Sparkles } from 'lucide-react'
import type { Chapter, Highlight, ImageSelectionInfo } from '../../types'
import { buildWeakPointIndexMap, getWeakPointColorSlot } from '../../utils/weakPointStyle'

type HighlightColor = 'yellow' | 'pink' | 'purple' | 'blue' | 'green'

const HIGHLIGHT_COLORS: { key: HighlightColor; className: string; swatch: string }[] = [
  { key: 'yellow', className: 'user-highlight-yellow', swatch: '#f4c96b' },
  { key: 'pink', className: 'user-highlight-pink', swatch: '#fb7185' },
  { key: 'purple', className: 'user-highlight-purple', swatch: '#a78bfa' },
  { key: 'blue', className: 'user-highlight-blue', swatch: '#60a5fa' },
  { key: 'green', className: 'user-highlight-green', swatch: '#4ade80' },
]

const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'
const HIGHLIGHT_META_PREFIX = '[specula-highlight:'

function highlightClassForColor(color: HighlightColor): string {
  return HIGHLIGHT_COLORS.find((c) => c.key === color)?.className || HIGHLIGHT_COLORS[0].className
}

function getHighlightColor(context: string): HighlightColor {
  if (!context.startsWith(HIGHLIGHT_META_PREFIX)) return DEFAULT_HIGHLIGHT_COLOR
  const end = context.indexOf(']')
  const color = context.slice(HIGHLIGHT_META_PREFIX.length, end > -1 ? end : undefined)
  return HIGHLIGHT_COLORS.some((c) => c.key === color) ? (color as HighlightColor) : DEFAULT_HIGHLIGHT_COLOR
}

function withHighlightMeta(context: string, color: HighlightColor): string {
  return `${HIGHLIGHT_META_PREFIX}${color}]\n${context}`
}

// Index every text node under `root` and the running text offset where it
// starts, so we can map a position in the concatenated text back to a DOM node.
function buildTextIndex(root: HTMLElement): { text: string; nodes: { node: Text; start: number }[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number }[] = []
  let text = ''
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    nodes.push({ node: t, start: text.length })
    text += t.nodeValue || ''
  }
  return { text, nodes }
}

function rangeFromOffsets(
  nodes: { node: Text; start: number }[],
  startOff: number,
  endOff: number
): Range | null {
  let startNode: Text | null = null
  let startNodeOffset = 0
  let endNode: Text | null = null
  let endNodeOffset = 0
  for (const { node, start } of nodes) {
    const len = node.nodeValue?.length || 0
    if (startNode == null && startOff < start + len) {
      startNode = node
      startNodeOffset = startOff - start
    }
    if (startNode != null && endOff <= start + len) {
      endNode = node
      endNodeOffset = endOff - start
      break
    }
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  try {
    range.setStart(startNode, startNodeOffset)
    range.setEnd(endNode, endNodeOffset)
  } catch {
    return null
  }
  return range
}

// Normalize one char for loose matching: full-width -> half-width, lowercase,
// and keep only CJK / letters / digits (drops all whitespace and punctuation).
function normalizeChar(ch: string): string {
  const code = ch.charCodeAt(0)
  let c = ch
  if (code >= 0xff01 && code <= 0xff5e) c = String.fromCharCode(code - 0xfee0)
  else if (code === 0x3000) c = ' '
  c = c.toLowerCase()
  if (/[a-z0-9]/.test(c)) return c
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(c)) return c
  return ''
}

// Build a normalized string plus a map from each normalized-char index back to
// its original offset in `text`.
function buildNormalized(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const n = normalizeChar(text[i])
    if (n) {
      norm += n
      map.push(i)
    }
  }
  return { norm, map }
}

// Longest common substring of haystack `a` and needle `b`; returns its start in
// `a` and length (rolling 1D DP, O(a*b) time, O(b) memory).
function longestCommonSubstring(a: string, b: string): { aStart: number; len: number } {
  const m = b.length
  if (a.length === 0 || m === 0) return { aStart: -1, len: 0 }
  let prev = new Int32Array(m + 1)
  let curr = new Int32Array(m + 1)
  let best = 0
  let bestAEnd = -1
  for (let i = 1; i <= a.length; i++) {
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= m; j++) {
      if (ai === b.charCodeAt(j - 1)) {
        curr[j] = prev[j - 1] + 1
        if (curr[j] > best) {
          best = curr[j]
          bestAEnd = i
        }
      } else {
        curr[j] = 0
      }
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }
  if (best === 0) return { aStart: -1, len: 0 }
  return { aStart: bestAEnd - best, len: best }
}

// Exact substring match on raw DOM text — used for user manual highlights
// where selectedText is copied verbatim from the selection.
function locateExactExcerpt(root: HTMLElement, excerpt: string): Range | null {
  const { text, nodes } = buildTextIndex(root)
  if (!text || !excerpt) return null
  const idx = text.indexOf(excerpt)
  if (idx < 0) return null
  return rangeFromOffsets(nodes, idx, idx + excerpt.length)
}

// Find an excerpt in the rendered chapter. Matching is done on a normalized
// view (no whitespace/punctuation, full-width folded) so AI excerpts that
// differ in spacing or punctuation still match; if the whole excerpt can't be
// found, fall back to the longest contiguous run shared with the text.
function locateExcerpt(root: HTMLElement, excerpt: string): Range | null {
  const { text, nodes } = buildTextIndex(root)
  if (!text) return null

  const { norm, map } = buildNormalized(text)
  if (!norm) return null
  const target = buildNormalized(excerpt).norm
  if (target.length < 4) return null

  let start = norm.indexOf(target)
  let matchLen = target.length

  if (start < 0) {
    // Fuzzy fallback: highlight the longest contiguous chunk we can find.
    const anchor = longestCommonSubstring(norm, target)
    const minAnchor = Math.max(8, Math.floor(target.length * 0.3))
    if (anchor.len >= minAnchor) {
      start = anchor.aStart
      matchLen = anchor.len
    }
  }

  if (start < 0) return null
  const origStart = map[start]
  const origEnd = map[start + matchLen - 1] + 1
  return rangeFromOffsets(nodes, origStart, origEnd)
}

function locateHighlight(
  root: HTMLElement,
  excerpt: string
): Range | null {
  const exact = locateExactExcerpt(root, excerpt)
  if (exact) return exact
  return locateExcerpt(root, excerpt)
}

// Unwrap all <mark> elements, keeping their text content (no full DOM reset).
function stripMarks(el: HTMLElement): void {
  for (const mark of [...el.querySelectorAll('mark')]) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
}

function sanitizeRenderedChapter(el: HTMLElement): void {
  let nestedBody = el.querySelector('body')
  while (nestedBody) {
    const parent = nestedBody.parentNode
    if (!parent) break
    while (nestedBody.firstChild) parent.insertBefore(nestedBody.firstChild, nestedBody)
    parent.removeChild(nestedBody)
    nestedBody = el.querySelector('body')
  }

  el.querySelectorAll('head, style, script, link, meta, title').forEach((node) => node.remove())
}

// Highlight a range by wrapping each intersected text-node segment in its own
// <mark>. Per-node wrapping always satisfies surroundContents (single text
// node, no partial elements), so it works even when the range spans multiple
// inline/block elements. Returns true if at least one segment was marked.
function markRange(
  range: Range,
  className: string,
  meta?: { topic?: string; wpIndex?: number; colorSlot?: number }
): boolean {
  const rootNode = range.commonAncestorContainer
  const walkerRoot =
    rootNode.nodeType === Node.TEXT_NODE ? (rootNode.parentNode as Node) : rootNode
  if (!walkerRoot) return false

  const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (range.intersectsNode(n)) textNodes.push(n as Text)
  }

  let marked = false
  for (const tn of textNodes) {
    const r = document.createRange()
    r.selectNodeContents(tn)
    if (tn === range.startContainer) r.setStart(tn, range.startOffset)
    if (tn === range.endContainer) r.setEnd(tn, range.endOffset)
    if (r.collapsed) continue
    const mark = document.createElement('mark')
    const classes = [className]
    if (meta?.colorSlot) classes.push(`quiz-wp-${meta.colorSlot}`)
    mark.className = classes.join(' ')
    if (meta?.wpIndex) mark.setAttribute('data-wp-index', String(meta.wpIndex))
    if (meta?.topic) mark.setAttribute('data-topic', meta.topic)
    try {
      r.surroundContents(mark)
      marked = true
    } catch {
      // skip this segment
    }
  }
  return marked
}

interface Props {
  bookId: string
  chapters: Chapter[]
  chapterId: string | null
  chromeVisible?: boolean
  onChapterChange: (chapterId: string) => void
  onToggleChrome?: () => void
  initialPosition?: string
  highlightExcerpt?: string | null
  highlights?: Highlight[]
  onProgress: (chapterId: string | null, position: string) => void
  onTextSelect: (text: string, context: string, rect: DOMRect) => void
  onImageSelect?: (info: ImageSelectionInfo) => void
  onHighlightsChange?: () => void
  onUnlocatedChange?: (ids: string[]) => void
}

// We render EPUB chapters ourselves (chapter HTML fetched from the main process
// with images inlined). epub.js renders unreliably from in-memory archives in
// Electron, and native rendering also gives us native text selection for the AI
// highlight feature.
export default function EpubReader({
  bookId,
  chapters,
  chapterId: currentChapterId,
  chromeVisible = true,
  onChapterChange,
  onToggleChrome,
  initialPosition,
  highlightExcerpt,
  highlights,
  onProgress,
  onTextSelect,
  onImageSelect,
  onHighlightsChange,
  onUnlocatedChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const prevChapterIdRef = useRef<string | null>(null)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [isPaged, setIsPaged] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [pageWidth, setPageWidth] = useState(0)
  const [pageContentWidth, setPageContentWidth] = useState(0)
  const [viewportVersion, setViewportVersion] = useState(0)
  const pageGap = 24

  // Scroll fraction (0–1) to restore once the next chapter HTML is painted.
  // Seeded from saved progress for the very first chapter only.
  const restorePosRef = useRef<number | null>(
    initialPosition && !Number.isNaN(parseFloat(initialPosition)) ? parseFloat(initialPosition) : null
  )
  const pendingRestoreRef = useRef<number | null>(restorePosRef.current)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  // Debounce timer for persisting the intra-chapter scroll position.
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Floating toolbar shown over a text selection (高亮 / AI 解释).
  const [selToolbar, setSelToolbar] = useState<{ top: number; left: number } | null>(null)
  const selRangeRef = useRef<Range | null>(null)
  const selInfoRef = useRef<{ text: string; context: string; rect: DOMRect } | null>(null)

  // All highlights (user + quiz) for the current chapter that have matchable text.
  const chapterHighlights = useMemo(
    () =>
      (highlights || []).filter(
        (h) =>
          h.chapterId === currentChapterId &&
          h.selectedText.trim() &&
          !h.selectedText.startsWith('[图片]')
      ),
    [highlights, currentChapterId]
  )

  useEffect(() => {
    const updatePagedMode = () => {
      setIsPaged(window.innerWidth < 768)
      setViewportVersion((version) => version + 1)
    }
    updatePagedMode()
    window.addEventListener('resize', updatePagedMode)
    return () => window.removeEventListener('resize', updatePagedMode)
  }, [])

  useEffect(() => {
    if (currentChapterId && prevChapterIdRef.current && prevChapterIdRef.current !== currentChapterId) {
      restorePosRef.current = 0
    }
    prevChapterIdRef.current = currentChapterId

    const chapter = chapters.find((c) => c.id === currentChapterId) || chapters[0]
    if (!chapter) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    window.specula.epub.getChapterHtml(bookId, chapter.startRef).then((h) => {
      if (cancelled) return
      const restore = restorePosRef.current
      restorePosRef.current = null
      pendingRestoreRef.current = restore
      setHtml(h || '<p style="opacity:.6">本章无可显示内容</p>')
      setLoading(false)
      // Restore scroll after the new content has been laid out.
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el || isPaged) return
        const max = el.scrollHeight - el.clientHeight
        el.scrollTop = restore != null && max > 0 ? max * restore : 0
      })
      onProgress(chapter.id, restore != null ? String(restore) : '0')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, currentChapterId])

  // Load chapter HTML into the content container (sole writer — no dangerouslySetInnerHTML).
  useEffect(() => {
    if (loading) return
    const el = contentRef.current
    if (!el) return
    el.innerHTML = html
    sanitizeRenderedChapter(el)
    const images = Array.from(el.querySelectorAll('img'))
    const refreshLayout = () => setViewportVersion((version) => version + 1)
    images.forEach((img) => {
      if (!img.complete) img.addEventListener('load', refreshLayout, { once: true })
    })
    return () => {
      images.forEach((img) => img.removeEventListener('load', refreshLayout))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, loading])

  // Re-apply highlights without resetting innerHTML: strip old marks, then paint.
  useEffect(() => {
    if (loading) return
    const el = contentRef.current
    if (!el || !el.innerHTML) return
    stripMarks(el)
    const unlocated: string[] = []
    const wpIndexMap = buildWeakPointIndexMap(chapterHighlights)
    for (const h of chapterHighlights) {
      const range = locateHighlight(el, h.selectedText)
      const wpIndex = h.source === 'quiz' ? wpIndexMap.get(h.id) : undefined
      const ok = range
        ? h.source === 'quiz'
          ? markRange(range, 'quiz-highlight', {
              topic: h.weakPointTopic || '',
              wpIndex,
              colorSlot: wpIndex ? getWeakPointColorSlot(wpIndex) : undefined,
            })
          : markRange(range, `user-highlight ${highlightClassForColor(getHighlightColor(h.context))}`)
        : false
      if (!ok) unlocated.push(h.id)
    }
    onUnlocatedChange?.(unlocated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, chapterHighlights, loading])

  useEffect(() => {
    if (loading) return
    const container = scrollRef.current
    const content = contentRef.current
    if (!container || !content) return

    if (!isPaged) {
      setPageCount(1)
      setPageIndex(0)
      setPageWidth(0)
      const restore = pendingRestoreRef.current
      pendingRestoreRef.current = null
      const max = container.scrollHeight - container.clientHeight
      if (restore != null && max > 0) container.scrollTop = max * restore
      return
    }

    const measure = () => {
      const width = container.clientWidth
      const contentWidth = Math.max(280, width - 64)
      if (!width) return
      setPageWidth(width)
      setPageContentWidth(contentWidth)
      const horizontalPadding = width - contentWidth
      const scrollableColumnsWidth = Math.max(contentWidth, content.scrollWidth - horizontalPadding)
      const count = Math.max(1, Math.ceil((scrollableColumnsWidth + pageGap) / (contentWidth + pageGap)))
      const restore = pendingRestoreRef.current
      pendingRestoreRef.current = null
      setPageCount(count)
      setPageIndex((prev) => {
        if (restore != null) return Math.min(count - 1, Math.max(0, Math.round(restore * (count - 1))))
        return Math.min(prev, count - 1)
      })
    }

    requestAnimationFrame(() => requestAnimationFrame(measure))
  }, [html, chapterHighlights, loading, isPaged, viewportVersion])

  useEffect(() => {
    if (!isPaged || loading) return
    const fraction = pageCount > 1 ? pageIndex / (pageCount - 1) : 0
    onProgress(currentChapterId, String(fraction))
  }, [currentChapterId, isPaged, loading, onProgress, pageCount, pageIndex])

  // Deep link: scroll to (and briefly flash) the excerpt once the chapter renders.
  useEffect(() => {
    if (!highlightExcerpt || loading) return
    const el = contentRef.current
    if (!el) return
    const range = locateExcerpt(el, highlightExcerpt)
    const target = (range?.startContainer.parentElement as HTMLElement) || null
    if (target) {
      if (isPaged && pageWidth) {
        const pageStride = (pageContentWidth || pageWidth) + pageGap
        const targetPage = Math.floor(target.offsetLeft / pageStride)
        setPageIndex(Math.min(Math.max(0, targetPage), pageCount - 1))
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      target.classList.add('deeplink-flash')
      window.setTimeout(() => target.classList.remove('deeplink-flash'), 2400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlightExcerpt, loading, chapterHighlights, isPaged, pageCount, pageWidth])

  // Persist intra-chapter scroll position as a fraction (debounced).
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el || loading || isPaged) return
    const max = el.scrollHeight - el.clientHeight
    const fraction = max > 0 ? el.scrollTop / max : 0
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = setTimeout(() => {
      onProgress(currentChapterId, String(fraction))
    }, 400)
  }

  useEffect(() => {
    return () => {
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    }
  }, [])

  const idx = chapters.findIndex((c) => c.id === currentChapterId)
  const goPrev = () => {
    if (idx > 0) onChapterChange(chapters[idx - 1].id)
  }
  const goNext = () => {
    if (idx >= 0 && idx < chapters.length - 1) onChapterChange(chapters[idx + 1].id)
  }
  const turnPage = (delta: 1 | -1) => {
    window.getSelection()?.removeAllRanges()
    setSelToolbar(null)
    if (!isPaged) {
      if (delta > 0) goNext()
      else goPrev()
      return
    }
    if (delta > 0) {
      if (pageIndex < pageCount - 1) setPageIndex((p) => Math.min(pageCount - 1, p + 1))
      else goNext()
    } else if (pageIndex > 0) {
      setPageIndex((p) => Math.max(0, p - 1))
    } else {
      goPrev()
    }
  }

  // Listen for text selection changes (works on both desktop mouse and iOS touch).
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        setSelToolbar(null)
        return
      }
      const text = sel.toString().trim()
      if (!text) {
        setSelToolbar(null)
        return
      }
      // Only respond to selections inside our content area
      const content = contentRef.current
      if (!content || !content.contains(sel.anchorNode)) {
        setSelToolbar(null)
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const toolbarWidth = Math.min(window.innerWidth - 24, 336)
      const toolbarHeight = 116
      const contextEl = range.commonAncestorContainer.parentElement
      const context = contextEl?.textContent?.slice(0, 500) || ''
      selRangeRef.current = range.cloneRange()
      selInfoRef.current = { text, context, rect }
      const top = rect.top - toolbarHeight - 12
      const fallbackTop = rect.bottom + 12
      setSelToolbar({
        top: top > 8 ? top : Math.min(fallbackTop, window.innerHeight - toolbarHeight - 8),
        left: Math.min(
          Math.max(12, rect.left + rect.width / 2 - toolbarWidth / 2),
          window.innerWidth - toolbarWidth - 12
        ),
      })
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  useEffect(() => {
    const preventContentContextMenu = (event: Event) => {
      const content = contentRef.current
      if (content && event.target instanceof Node && content.contains(event.target)) {
        event.preventDefault()
      }
    }
    document.addEventListener('contextmenu', preventContentContextMenu)
    return () => document.removeEventListener('contextmenu', preventContentContextMenu)
  }, [])

  const handleCopySelection = async () => {
    const info = selInfoRef.current
    if (!info) return
    try {
      await navigator.clipboard?.writeText(info.text)
    } catch {
      // Clipboard permission can be unavailable inside some WebViews.
    }
    setSelToolbar(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleManualHighlight = async (color: HighlightColor = DEFAULT_HIGHLIGHT_COLOR) => {
    const info = selInfoRef.current
    if (!info) return
    window.getSelection()?.removeAllRanges()
    setSelToolbar(null)
    try {
      await window.specula.highlights.create({
        bookId,
        chapterId: currentChapterId,
        selectedText: info.text,
        context: withHighlightMeta(info.context, color),
        aiExplanation: null,
        teachingMode: null,
        source: 'user',
        weakPointTopic: null,
        weakPointIndex: null,
      })
      onHighlightsChange?.()
    } catch {
      // Persistence failure — applyHighlights will not run without a refresh.
    }
  }

  const handleExplainSelection = () => {
    const info = selInfoRef.current
    setSelToolbar(null)
    if (info) onTextSelect(info.text, info.context, info.rect)
  }

  // Click an inlined image to ask the vision model to explain it.
  const handleClick = (e: React.MouseEvent) => {
    if (!onImageSelect) return
    const target = e.target as HTMLElement
    if (target.tagName !== 'IMG') {
      if (isPaged && !window.getSelection()?.toString()) onToggleChrome?.()
      return
    }
    const src = target.getAttribute('src') || ''
    if (!src.startsWith('data:image/')) return
    const alt = target.getAttribute('alt') || ''
    const figcaption =
      target.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || ''
    const context = target.parentElement?.textContent?.slice(0, 500) || ''
    const rect = target.getBoundingClientRect()
    onImageSelect({
      imageDataUrl: src,
      imageAltText: alt,
      imageCaption: figcaption,
      imageContext: context,
      rect,
    })
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isPaged || e.touches.length !== 1 || window.getSelection()?.toString()) return
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isPaged || !touchStartRef.current) return
    const start = touchStartRef.current
    touchStartRef.current = null
    const touch = e.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    turnPage(dx < 0 ? 1 : -1)
  }

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`epub-container flex-1 ${isPaged ? 'overflow-hidden' : 'overflow-y-auto'}`}
      >
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">加载章节中...</div>
        ) : (
          <div
            ref={contentRef}
            className={`epub-content epub-content--images px-8 py-8 ${
              isPaged ? 'epub-content--paged max-w-none' : 'mx-auto max-w-3xl'
            }`}
            style={
              isPaged
                ? {
                    boxSizing: 'border-box',
                    columnGap: pageGap,
                    columnWidth: pageContentWidth || undefined,
                    height: '100%',
                    transform: `translate3d(-${pageIndex * ((pageContentWidth || pageWidth) + pageGap)}px, 0, 0)`,
                    transition: 'transform 180ms ease-out',
                    width: pageWidth || undefined,
                  }
                : undefined
            }
            onClick={handleClick}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}
      </div>

      {selToolbar && (
        <div
          style={{ position: 'fixed', top: selToolbar.top, left: selToolbar.left, zIndex: 1000 }}
          className="selection-menu w-[min(calc(100vw-24px),336px)]"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
        >
          <div className="selection-menu__styles">
            <button
              type="button"
              className="selection-menu__style-button selection-menu__style-button--active"
              onClick={() => handleManualHighlight(DEFAULT_HIGHLIGHT_COLOR)}
              aria-label="默认高亮"
            >
              <span>A</span>
            </button>
            <button
              type="button"
              className="selection-menu__style-button"
              onClick={() => handleManualHighlight(DEFAULT_HIGHLIGHT_COLOR)}
              aria-label="下划线高亮"
            >
              <span className="border-b-2 border-white/80">A</span>
            </button>
            <div className="selection-menu__colors">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  className="selection-menu__color"
                  style={{ backgroundColor: color.swatch }}
                  onClick={() => handleManualHighlight(color.key)}
                  aria-label={`${color.key} 高亮`}
                >
                  {color.key === DEFAULT_HIGHLIGHT_COLOR && <Check className="h-4 w-4 text-gray-900" />}
                </button>
              ))}
            </div>
          </div>
          <div className="selection-menu__actions">
            <button type="button" className="selection-menu__action" onClick={handleCopySelection}>
              <Copy className="h-5 w-5" />
              <span>复制</span>
            </button>
            <button type="button" className="selection-menu__action" onClick={() => handleManualHighlight()}>
              <Highlighter className="h-5 w-5" />
              <span>高亮</span>
            </button>
            <button type="button" className="selection-menu__action" onClick={handleExplainSelection}>
              <Sparkles className="h-5 w-5" />
              <span>AI 解释</span>
            </button>
          </div>
        </div>
      )}

      <div
        className={`flex shrink-0 items-center justify-between border-t border-gray-200 bg-white/95 px-4 py-2 shadow-[0_-2px_12px_rgba(15,23,42,0.08)] backdrop-blur transition-transform duration-200 dark:border-gray-700 dark:bg-gray-900/95 ${
          isPaged
            ? `absolute inset-x-0 bottom-0 z-20 ${chromeVisible ? 'translate-y-0' : 'translate-y-full'}`
            : ''
        }`}
        style={isPaged ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' } : undefined}
      >
        <button
          onClick={() => turnPage(-1)}
          disabled={isPaged ? idx <= 0 && pageIndex <= 0 : idx <= 0}
          className="btn-secondary py-1.5 text-[0px]"
        >
          <span className="text-xs">{isPaged ? '上一页' : '上一章'}</span>
          上一章
        </button>
        <span className="max-w-md truncate px-2 text-xs text-gray-500">
          {isPaged ? `${pageIndex + 1}/${pageCount} · ${chapters[idx]?.title || ''}` : chapters[idx]?.title || ''}
        </span>
        <button
          onClick={() => turnPage(1)}
          disabled={isPaged ? idx >= chapters.length - 1 && pageIndex >= pageCount - 1 : idx >= chapters.length - 1}
          className="btn-secondary py-1.5 text-[0px]"
        >
          <span className="text-xs">{isPaged ? '下一页' : '下一章'}</span>
          下一章
        </button>
      </div>
    </div>
  )
}
