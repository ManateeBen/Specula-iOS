import { useEffect, useRef, useState, useMemo } from 'react'
import { List, SkipBack, SkipForward, Sparkles } from 'lucide-react'
import type { Chapter, CodeSelectionInfo, Highlight, ImageSelectionInfo, ReadingMode } from '../../types'
import { buildWeakPointIndexMap, getWeakPointColorSlot } from '../../utils/weakPointStyle'

type HighlightColor = 'yellow' | 'pink' | 'purple' | 'blue' | 'green'

const HIGHLIGHT_COLORS: { key: HighlightColor; className: string }[] = [
  { key: 'yellow', className: 'user-highlight-yellow' },
  { key: 'pink', className: 'user-highlight-pink' },
  { key: 'purple', className: 'user-highlight-purple' },
  { key: 'blue', className: 'user-highlight-blue' },
  { key: 'green', className: 'user-highlight-green' },
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
    if (mark.classList.contains('selection-preview')) continue
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
}

function stripSelectionPreview(el: HTMLElement): void {
  for (const mark of [...el.querySelectorAll('mark.selection-preview')]) {
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

function prepareCodeBlocks(el: HTMLElement): void {
  for (const pre of Array.from(el.querySelectorAll('pre'))) {
    if (pre.closest('.epub-code-shell')) continue
    const parent = pre.parentNode
    if (!parent) continue

    const shell = document.createElement('div')
    shell.className = 'epub-code-shell'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'epub-code-explain'
    button.dataset.codeExplain = 'true'
    button.setAttribute('aria-label', 'AI 解读代码')
    button.setAttribute('title', 'AI 解读代码')

    parent.insertBefore(shell, pre)
    shell.append(button, pre)
  }
}

function detectCodeLanguage(pre: HTMLElement): string {
  const candidates = [pre.dataset.language, pre.className, pre.querySelector('code')?.className]
  for (const candidate of candidates) {
    if (!candidate) continue
    const match = candidate.match(/(?:language|lang)-([\w+#.-]+)/i)
    if (match?.[1]) return match[1]
  }
  return 'plain'
}

function nearbyText(element: Element | null, direction: 'before' | 'after'): string {
  let sibling = direction === 'before' ? element?.previousElementSibling : element?.nextElementSibling
  while (sibling) {
    const text = sibling.textContent?.replace(/\s+/g, ' ').trim() || ''
    if (text) return direction === 'before' ? text.slice(-1200) : text.slice(0, 1200)
    sibling = direction === 'before' ? sibling.previousElementSibling : sibling.nextElementSibling
  }
  return ''
}

// Highlight a range by wrapping each intersected text-node segment in its own
// <mark>. Per-node wrapping always satisfies surroundContents (single text
// node, no partial elements), so it works even when the range spans multiple
// inline/block elements. Returns true if at least one segment was marked.
function markRange(
  range: Range,
  className: string,
  meta?: { highlightId?: string; topic?: string; wpIndex?: number; colorSlot?: number }
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
    if (meta?.highlightId) mark.setAttribute('data-highlight-id', meta.highlightId)
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
  readingMode?: ReadingMode
  chapters: Chapter[]
  chapterId: string | null
  bookTitle?: string
  chapterTitle?: string
  chapterNumber?: number
  runtimeMinutes?: number
  chromeVisible?: boolean
  onChapterChange: (chapterId: string) => void
  onToggleChrome?: () => void
  initialPosition?: string
  highlightExcerpt?: string | null
  gapAnchorExcerpt?: string | null
  gapEvidenceExcerpt?: string | null
  highlights?: Highlight[]
  onProgress: (chapterId: string | null, position: string) => void
  onTextSelect: (text: string, context: string, rect: DOMRect) => void
  onExplainAndHighlight: (text: string, context: string, rect: DOMRect) => void
  onHighlightSelect?: (highlight: Highlight) => void
  onImageSelect?: (info: ImageSelectionInfo) => void
  onCodeSelect?: (info: CodeSelectionInfo) => void
  onGapAnchorStateChange?: (state: 'locating' | 'visible' | 'missing') => void
  onUnlocatedChange?: (ids: string[]) => void
  onToggleToc?: () => void
  onPreview?: () => void
}

function formatPlaybackTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

// We render EPUB chapters ourselves (chapter HTML fetched from the main process
// with images inlined). epub.js renders unreliably from in-memory archives in
// Electron, and native rendering also gives us native text selection for the AI
// highlight feature.
export default function EpubReader({
  bookId,
  readingMode = 'scroll',
  chapters,
  chapterId: currentChapterId,
  bookTitle,
  chapterTitle,
  chapterNumber = 1,
  runtimeMinutes = 3,
  chromeVisible = true,
  onChapterChange,
  onToggleChrome,
  initialPosition,
  highlightExcerpt,
  gapAnchorExcerpt,
  gapEvidenceExcerpt,
  highlights,
  onProgress,
  onTextSelect,
  onExplainAndHighlight,
  onHighlightSelect,
  onImageSelect,
  onCodeSelect,
  onGapAnchorStateChange,
  onUnlocatedChange,
  onToggleToc,
  onPreview,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageTrackRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const swipeRootRef = useRef<HTMLDivElement>(null)
  const prevPreviewRef = useRef<HTMLDivElement>(null)
  const nextPreviewRef = useRef<HTMLDivElement>(null)
  const prevPreviewContentRef = useRef<HTMLDivElement>(null)
  const nextPreviewContentRef = useRef<HTMLDivElement>(null)
  const swipeAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevChapterIdRef = useRef<string | null>(null)
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [scrollFraction, setScrollFraction] = useState(() => {
    const initial = Number.parseFloat(initialPosition || '0')
    return Number.isFinite(initial) ? Math.min(1, Math.max(0, initial)) : 0
  })
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const pagedMode = isMobile && readingMode === 'paged'
  const [viewportVersion, setViewportVersion] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const pageIndexRef = useRef(0)
  const pageCountRef = useRef(1)
  const pendingChapterSwipeRef = useRef<'prev' | 'next' | null>(null)

  // Scroll fraction (0–1) to restore once the next chapter HTML is painted.
  // Seeded from saved progress for the very first chapter only.
  const restorePosRef = useRef<number | null>(
    initialPosition && !Number.isNaN(parseFloat(initialPosition)) ? parseFloat(initialPosition) : null
  )
  const pendingRestoreRef = useRef<number | null>(restorePosRef.current)
  const selectionSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSelectionKeyRef = useRef('')
  const customSelectionRef = useRef<{
    anchorRange: Range | null
    currentRange: Range | null
    longPressTimer: ReturnType<typeof setTimeout> | null
    selecting: boolean
    startX: number
    startY: number
    lastX: number
    lastY: number
    rafId: number | null
    autoScrollRaf: number | null
    autoScrollV: number
    lockedScrollTop: number | null
    previousOverflowY: string | null
    suppressClickUntil: number
  }>({
    anchorRange: null,
    currentRange: null,
    longPressTimer: null,
    selecting: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    rafId: null,
    autoScrollRaf: null,
    autoScrollV: 0,
    lockedScrollTop: null,
    previousOverflowY: null,
    suppressClickUntil: 0,
  })
  const swipeRef = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startedAt: 0,
    tracking: false,
    startedInCodeBlock: false,
    axis: 'pending' as 'pending' | 'horizontal' | 'vertical',
    dragging: false,
  })
  // Debounce timer for persisting the intra-chapter scroll position.
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Floating toolbar shown over a text selection (高亮 / AI 解释).
  const [selToolbar, setSelToolbar] = useState<{ top: number; left: number } | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const selectionOverlayRef = useRef<HTMLDivElement>(null)
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
    const updateMobileMode = () => {
      setIsMobile(window.innerWidth < 768)
      setViewportVersion((version) => version + 1)
    }
    updateMobileMode()
    window.addEventListener('resize', updateMobileMode)
    return () => window.removeEventListener('resize', updateMobileMode)
  }, [])

  useEffect(() => {
    if (
      currentChapterId &&
      prevChapterIdRef.current &&
      prevChapterIdRef.current !== currentChapterId &&
      restorePosRef.current == null
    ) {
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
      // Restore scroll after the new content has been laid out. Mobile uses the
      // same fraction to select a laid-out page in the pagination effect below.
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el || pagedMode) return
        const max = el.scrollHeight - el.clientHeight
        el.scrollTop = restore != null && max > 0 ? max * restore : 0
        setScrollFraction(restore != null ? Math.min(1, Math.max(0, restore)) : 0)
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
    prepareCodeBlocks(el)
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
              highlightId: h.id,
              topic: h.weakPointTopic || '',
              wpIndex,
              colorSlot: wpIndex ? getWeakPointColorSlot(wpIndex) : undefined,
            })
          : markRange(range, `user-highlight ${highlightClassForColor(getHighlightColor(h.context))}`, {
              highlightId: h.id,
            })
        : false
      if (!ok) unlocated.push(h.id)
    }
    onUnlocatedChange?.(unlocated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, chapterHighlights, loading])

  useEffect(() => {
    if (loading) return
    const container = scrollRef.current
    if (!container) return
    requestAnimationFrame(() => {
      const restore = pendingRestoreRef.current
      pendingRestoreRef.current = null
      if (pagedMode) {
        const track = pageTrackRef.current
        const content = contentRef.current
        if (!track || !content) return
        const width = Math.max(container.clientWidth, 1)
        content.style.setProperty('--epub-page-width', `${width}px`)
        content.style.setProperty('--epub-page-content-width', `${Math.max(width - 48, 1)}px`)
        const bodyPageCount = Math.max(1, Math.ceil((content.scrollWidth + 48) / width))
        const count = bodyPageCount + 1
        const currentFraction = pageCountRef.current > 1
          ? pageIndexRef.current / (pageCountRef.current - 1)
          : scrollFraction
        const targetFraction = restore == null ? currentFraction : Math.min(1, Math.max(0, restore))
        const targetPage = Math.min(count - 1, Math.max(0, Math.round(targetFraction * (count - 1))))
        pageCountRef.current = count
        pageIndexRef.current = targetPage
        setPageCount(count)
        setPageIndex(targetPage)
        setScrollFraction(count > 1 ? targetPage / (count - 1) : 0)
        track.style.width = `${count * width}px`
        track.style.transition = 'none'
        track.style.transform = `translate3d(${-targetPage * width}px, 0, 0)`
        container.scrollTop = 0

        if (pendingChapterSwipeRef.current) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              pendingChapterSwipeRef.current = null
              resetSwipeSurface(false)
            })
          })
        }
        return
      }
      const track = pageTrackRef.current
      const content = contentRef.current
      if (track) {
        track.style.width = ''
        track.style.transition = ''
        track.style.transform = ''
      }
      if (content) {
        content.style.removeProperty('--epub-page-width')
        content.style.removeProperty('--epub-page-content-width')
      }
      pageCountRef.current = 1
      pageIndexRef.current = 0
      setPageCount(1)
      setPageIndex(0)
      const targetFraction = restore == null ? scrollFraction : Math.min(1, Math.max(0, restore))
      const max = container.scrollHeight - container.clientHeight
      container.scrollTop = max > 0 ? max * targetFraction : 0
      setScrollFraction(targetFraction)
    })
  }, [html, chapterHighlights, pagedMode, loading, viewportVersion])

  // Deep link: scroll to (and briefly flash) the excerpt once the chapter renders.
  useEffect(() => {
    if (!highlightExcerpt || loading) return
    const el = contentRef.current
    if (!el) return
    const range = locateExcerpt(el, highlightExcerpt)
    const startElement = (range?.startContainer.parentElement as HTMLElement) || null
    const target = (startElement?.closest('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6') as HTMLElement | null)
      || startElement
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('deeplink-flash')
      window.setTimeout(() => target.classList.remove('deeplink-flash'), 2400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlightExcerpt, loading, chapterHighlights])

  useEffect(() => {
    const evidenceExcerpt = gapEvidenceExcerpt || gapAnchorExcerpt
    if (!evidenceExcerpt || loading) return
    const el = contentRef.current
    if (!el) return
    onGapAnchorStateChange?.('locating')
    const range = locateExcerpt(el, evidenceExcerpt) || (gapAnchorExcerpt ? locateExcerpt(el, gapAnchorExcerpt) : null)
    const startElement = (range?.startContainer.parentElement as HTMLElement) || null
    const target = (startElement?.closest('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6') as HTMLElement | null)
      || startElement
    if (!target) {
      onGapAnchorStateChange?.('missing')
      return
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('gap-anchor-highlight')
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.35) {
        target.classList.add('gap-anchor-arrived')
        onGapAnchorStateChange?.('visible')
      }
    }, { root: scrollRef.current, threshold: [0.35, 0.6] })
    observer.observe(target)
    return () => {
      observer.disconnect()
      target.classList.remove('gap-anchor-highlight', 'gap-anchor-arrived')
    }
  }, [html, gapAnchorExcerpt, gapEvidenceExcerpt, loading, onGapAnchorStateChange])

  // Persist intra-chapter scroll position as a fraction (debounced).
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el || loading) return
    if (pagedMode) return
    if (customSelectionRef.current.selecting) {
      const locked = customSelectionRef.current.lockedScrollTop
      if (locked != null && el.scrollTop !== locked) el.scrollTop = locked
      return
    }
    // A settled mobile selection is painted in viewport coordinates, so once the
    // user scrolls the chapter (not our own drag auto-scroll) it would drift off
    // the text. Dismiss it, matching native reader behavior.
    if (isMobile && selInfoRef.current && !customSelectionRef.current.selecting) {
      clearSelectionState()
    }
    const max = el.scrollHeight - el.clientHeight
    const fraction = max > 0 ? el.scrollTop / max : 0
    setScrollFraction(fraction)
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

  useEffect(() => {
    return () => {
      const sel = customSelectionRef.current
      if (sel.longPressTimer) clearTimeout(sel.longPressTimer)
      if (sel.rafId != null) cancelAnimationFrame(sel.rafId)
      if (sel.autoScrollRaf != null) cancelAnimationFrame(sel.autoScrollRaf)
      if (swipeAnimationTimerRef.current) clearTimeout(swipeAnimationTimerRef.current)
      if (scrollRef.current && sel.previousOverflowY != null) {
        scrollRef.current.style.overflowY = sel.previousOverflowY
      }
      if (scrollRef.current) {
        scrollRef.current.style.transition = ''
        scrollRef.current.style.transform = ''
      }
      if (pageTrackRef.current) {
        pageTrackRef.current.style.transition = ''
        pageTrackRef.current.style.transform = ''
      }
      contentRef.current?.classList.remove('epub-selecting')
      const layer = selectionOverlayRef.current
      if (layer) {
        for (const child of Array.from(layer.children)) {
          ;(child as HTMLElement).style.display = 'none'
        }
      }
    }
  }, [])

  const idx = chapters.findIndex((c) => c.id === currentChapterId)
  const prevChapter = idx > 0 ? chapters[idx - 1] : null
  const nextChapter = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null
  const totalSeconds = runtimeMinutes * 60
  const elapsedSeconds = totalSeconds * scrollFraction

  useEffect(() => {
    let cancelled = false
    const loadPreview = async (chapter: Chapter | null, target: HTMLDivElement | null) => {
      if (!target) return
      if (!chapter) {
        target.replaceChildren()
        return
      }
      const previewHtml = await window.specula.epub.getChapterHtml(bookId, chapter.startRef)
      if (cancelled) return
      target.innerHTML = previewHtml || ''
      sanitizeRenderedChapter(target)
      target.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
    }

    void Promise.all([
      loadPreview(prevChapter, prevPreviewContentRef.current),
      loadPreview(nextChapter, nextPreviewContentRef.current),
    ])
    return () => {
      cancelled = true
    }
  }, [bookId, prevChapter?.id, prevChapter?.startRef, nextChapter?.id, nextChapter?.startRef])

  const clearSelectionState = () => {
    window.getSelection()?.removeAllRanges()
    if (contentRef.current) stripSelectionPreview(contentRef.current)
    const sel = customSelectionRef.current
    if (sel.longPressTimer) {
      clearTimeout(sel.longPressTimer)
      sel.longPressTimer = null
    }
    if (sel.rafId != null) {
      cancelAnimationFrame(sel.rafId)
      sel.rafId = null
    }
    if (sel.autoScrollRaf != null) {
      cancelAnimationFrame(sel.autoScrollRaf)
      sel.autoScrollRaf = null
    }
    sel.autoScrollV = 0
    if (scrollRef.current && sel.previousOverflowY != null) {
      scrollRef.current.style.overflowY = sel.previousOverflowY
    }
    sel.lockedScrollTop = null
    sel.previousOverflowY = null
    sel.anchorRange = null
    sel.currentRange = null
    sel.selecting = false
    contentRef.current?.classList.remove('epub-selecting')
    const layer = selectionOverlayRef.current
    if (layer) {
      for (const child of Array.from(layer.children)) {
        ;(child as HTMLElement).style.display = 'none'
      }
    }
    setSelToolbar(null)
    lastSelectionKeyRef.current = ''
    selInfoRef.current = null
  }
  const goPrev = () => {
    clearSelectionState()
    if (idx > 0) onChapterChange(chapters[idx - 1].id)
  }
  const goNext = () => {
    clearSelectionState()
    if (idx >= 0 && idx < chapters.length - 1) onChapterChange(chapters[idx + 1].id)
  }

  const savePageProgress = (nextPage: number) => {
    const count = pageCountRef.current
    const fraction = count > 1 ? nextPage / (count - 1) : 0
    pageIndexRef.current = nextPage
    setPageIndex(nextPage)
    setScrollFraction(fraction)
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = setTimeout(() => {
      onProgress(currentChapterId, String(fraction))
    }, 250)
  }

  const resetSwipeSurface = (animated: boolean) => {
    const surface = pageTrackRef.current
    const root = swipeRootRef.current
    const width = Math.max(scrollRef.current?.clientWidth || window.innerWidth, 320)
    const baseX = pagedMode ? -pageIndexRef.current * width : 0
    const transition = animated
        ? 'transform 280ms cubic-bezier(0.22, 0.8, 0.24, 1)'
        : 'none'
    if (surface) {
      surface.style.transition = transition
      surface.style.transform = `translate3d(${baseX}px, 0, 0)`
    }
    if (prevPreviewRef.current) {
      prevPreviewRef.current.style.transition = transition
      prevPreviewRef.current.style.transform = 'translate3d(-100%, 0, 0)'
    }
    if (nextPreviewRef.current) {
      nextPreviewRef.current.style.transition = transition
      nextPreviewRef.current.style.transform = 'translate3d(100%, 0, 0)'
    }
    if (root) {
      delete root.dataset.swipeDirection
      delete root.dataset.swipeKind
    }
  }

  const updateSwipeDrag = (e: React.TouchEvent, clientX: number, clientY: number) => {
    const swipe = swipeRef.current
    if (!pagedMode || !swipe.tracking || swipe.startedInCodeBlock || selInfoRef.current) return false

    const dx = clientX - swipe.startX
    const dy = clientY - swipe.startY
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    if (swipe.axis === 'pending' && Math.max(absX, absY) >= 10) {
      swipe.axis = absX > absY * 1.25 ? 'horizontal' : 'vertical'
      if (swipe.axis === 'horizontal') {
        cancelCustomLongPress()
      }
    }
    if (swipe.axis !== 'horizontal') return false

    e.preventDefault()
    swipe.dragging = true
    const currentPage = pageIndexRef.current
    const totalPages = pageCountRef.current
    const canMove = dx < 0
      ? currentPage < totalPages - 1 || idx < chapters.length - 1
      : currentPage > 0 || idx > 0
    const resistedDx = canMove ? dx * 0.94 : dx * 0.18
    const width = Math.max(scrollRef.current?.clientWidth || window.innerWidth, 320)
    const baseX = -currentPage * width
    const surface = pageTrackRef.current
    if (surface) {
      surface.style.transition = 'none'
      surface.style.transform = `translate3d(${baseX + resistedDx}px, 0, 0)`
    }
    if (prevPreviewRef.current) {
      prevPreviewRef.current.style.transition = 'none'
      prevPreviewRef.current.style.transform = `translate3d(${resistedDx - width}px, 0, 0)`
    }
    if (nextPreviewRef.current) {
      nextPreviewRef.current.style.transition = 'none'
      nextPreviewRef.current.style.transform = `translate3d(${resistedDx + width}px, 0, 0)`
    }
    const crossingChapter = dx < 0 ? currentPage >= totalPages - 1 : currentPage <= 0
    if (swipeRootRef.current && crossingChapter) {
      swipeRootRef.current.dataset.swipeDirection = dx < 0 ? 'next' : 'prev'
      swipeRootRef.current.dataset.swipeKind = 'chapter'
    } else if (swipeRootRef.current) {
      swipeRootRef.current.dataset.swipeDirection = dx < 0 ? 'next' : 'prev'
      swipeRootRef.current.dataset.swipeKind = 'page'
    }
    return true
  }

  const finishSwipeIfNeeded = (cancelled = false) => {
    const swipe = swipeRef.current
    swipe.tracking = false
    if (!pagedMode || swipe.startedInCodeBlock || customSelectionRef.current.selecting || selInfoRef.current) {
      resetSwipeSurface(true)
      return false
    }

    const dx = swipe.lastX - swipe.startX
    const dy = swipe.lastY - swipe.startY
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    const elapsed = Math.max(Date.now() - swipe.startedAt, 1)
    const velocity = absX / elapsed
    const width = Math.max(scrollRef.current?.clientWidth || window.innerWidth, 320)
    const currentPage = pageIndexRef.current
    const totalPages = pageCountRef.current
    const targetPage = dx < 0 ? currentPage + 1 : currentPage - 1
    const turnsPage = targetPage >= 0 && targetPage < totalPages
    const hasNeighbor = turnsPage || (dx < 0 ? idx < chapters.length - 1 : idx > 0)
    const crossedDistance = absX >= Math.max(104, width * 0.28)
    const deliberateFlick = absX >= 64 && velocity >= 0.62
    const shouldTurn =
      !cancelled &&
      swipe.axis === 'horizontal' &&
      swipe.dragging &&
      hasNeighbor &&
      absX > absY * 1.25 &&
      (crossedDistance || deliberateFlick)
    swipe.dragging = false
    swipe.axis = 'pending'
    if (!shouldTurn) {
      resetSwipeSurface(true)
      return absX > 10 && absX > absY
    }

    customSelectionRef.current.suppressClickUntil = Date.now() + 450
    const surface = pageTrackRef.current
    const transition = 'transform 360ms cubic-bezier(0.2, 0.72, 0.2, 1)'
    if (surface) {
      surface.style.transition = transition
      const targetX = turnsPage
        ? -targetPage * width
        : -currentPage * width + (dx < 0 ? -width : width)
      surface.style.transform = `translate3d(${targetX}px, 0, 0)`
    }
    if (turnsPage) {
      if (prevPreviewRef.current) {
        prevPreviewRef.current.style.transition = transition
        prevPreviewRef.current.style.transform = 'translate3d(-100%, 0, 0)'
      }
      if (nextPreviewRef.current) {
        nextPreviewRef.current.style.transition = transition
        nextPreviewRef.current.style.transform = 'translate3d(100%, 0, 0)'
      }
      if (swipeAnimationTimerRef.current) clearTimeout(swipeAnimationTimerRef.current)
      swipeAnimationTimerRef.current = setTimeout(() => {
        savePageProgress(targetPage)
        resetSwipeSurface(false)
      }, 360)
      return true
    }
    if (prevPreviewRef.current) {
      prevPreviewRef.current.style.transition = transition
      prevPreviewRef.current.style.transform = `translate3d(${dx < 0 ? -width * 2 : 0}px, 0, 0)`
    }
    if (nextPreviewRef.current) {
      nextPreviewRef.current.style.transition = transition
      nextPreviewRef.current.style.transform = `translate3d(${dx < 0 ? 0 : width * 2}px, 0, 0)`
    }
    if (swipeAnimationTimerRef.current) clearTimeout(swipeAnimationTimerRef.current)
    swipeAnimationTimerRef.current = setTimeout(() => {
      pendingChapterSwipeRef.current = dx < 0 ? 'next' : 'prev'
      restorePosRef.current = dx < 0 ? 0 : 1
      clearSelectionState()
      if (dx < 0 && idx < chapters.length - 1) onChapterChange(chapters[idx + 1].id)
      else if (dx > 0 && idx > 0) onChapterChange(chapters[idx - 1].id)
    }, 360)
    return true
  }

  // Pull the display text, the best on-screen rect, and surrounding context out
  // of a range. Pure reads — no DOM mutation — so it is cheap enough to call
  // once when a selection settles.
  const extractSelectionInfo = (
    range: Range
  ): { text: string; visibleRect: DOMRect; context: string } | null => {
    const text = range.toString().trim()
    if (!text) return null
    const rect = range.getBoundingClientRect()
    const visibleRect =
      Array.from(range.getClientRects()).find(
        (r) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < window.innerHeight
      ) || (rect.width || rect.height ? rect : null)
    if (!visibleRect) return null
    const contextEl = range.commonAncestorContainer.parentElement
    const context = contextEl?.textContent?.slice(0, 500) || ''
    return { text, visibleRect, context }
  }

  const placeToolbar = (visibleRect: DOMRect, text: string, context: string) => {
    const toolbarWidth = 164
    const toolbarHeight = 44
    const minTop = isMobile ? 72 : 8
    selInfoRef.current = { text, context, rect: visibleRect }
    lastSelectionKeyRef.current = text
    const top = visibleRect.top - toolbarHeight - 10
    const fallbackTop = visibleRect.bottom + 10
    setSelToolbar({
      top: top > minTop ? top : Math.min(fallbackTop, window.innerHeight - toolbarHeight - 8),
      left: Math.min(
        Math.max(12, visibleRect.left + visibleRect.width / 2 - toolbarWidth / 2),
        window.innerWidth - toolbarWidth - 12
      ),
    })
  }

  // Desktop path: native selection drives this via selectionchange. We paint a
  // <mark> preview and clear the native range so the toolbar sits over a stable
  // highlight. Mobile never calls this (it uses the overlay layer instead).
  const showSelectionForRange = (range: Range) => {
    const content = contentRef.current
    if (!content) return
    stripSelectionPreview(content)
    const info = extractSelectionInfo(range)
    if (!info) {
      clearSelectionState()
      return
    }
    placeToolbar(info.visibleRect, info.text, info.context)
    if (info.text.length <= 2500) markRange(range.cloneRange(), 'selection-preview')
    window.getSelection()?.removeAllRanges()
  }

  // Mobile selection preview: draw the range as plain overlay rectangles in a
  // fixed, pointer-events:none layer. This NEVER touches the content DOM, so it
  // is reflow-free and the anchor/focus text nodes stay valid across the drag.
  const paintSelectionOverlay = (range: Range) => {
    const layer = selectionOverlayRef.current
    if (!layer) return
    const rects = range.getClientRects()
    let used = 0
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (r.width < 1 && r.height < 1) continue
      let div = layer.children[used] as HTMLElement | undefined
      if (!div) {
        div = document.createElement('div')
        div.className = 'epub-sel-rect'
        layer.appendChild(div)
      }
      div.style.transform = `translate(${r.left}px, ${r.top}px)`
      div.style.width = `${r.width}px`
      div.style.height = `${r.height}px`
      div.style.display = 'block'
      used += 1
    }
    for (let j = used; j < layer.children.length; j++) {
      ;(layer.children[j] as HTMLElement).style.display = 'none'
    }
  }

  // Called once on touchend: the drag is done, so now (and only now) we do the
  // expensive string/context extraction and the single setState that shows the
  // toolbar. The overlay stays painted underneath it.
  const finalizeMobileSelection = (range: Range) => {
    const info = extractSelectionInfo(range)
    if (!info) {
      clearSelectionState()
      return
    }
    paintSelectionOverlay(range)
    placeToolbar(info.visibleRect, info.text, info.context)
  }

  const rangeFromPoint = (x: number, y: number): Range | null => {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    let range = doc.caretRangeFromPoint?.(x, y) || null
    if (!range) {
      const pos = doc.caretPositionFromPoint?.(x, y)
      if (pos) {
        range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.collapse(true)
      }
    }
    const content = contentRef.current
    if (!range || !content || !content.contains(range.startContainer)) return null
    return range
  }

  const expandRangeAtPoint = (range: Range): Range | null => {
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return null
    const textNode = node as Text
    const text = textNode.nodeValue || ''
    if (!text) return null

    let offset = Math.min(range.startOffset, text.length - 1)
    while (offset > 0 && /\s/.test(text[offset])) offset -= 1
    if (/\s/.test(text[offset])) return null

    const asciiWord = /[A-Za-z0-9_.$-]/
    const hardBoundary = /[\s,.;:!?()[\]{}<>，。！？；：（）【】《》“”‘’、]/
    let start = offset
    let end = offset + 1

    if (asciiWord.test(text[offset])) {
      while (start > 0 && asciiWord.test(text[start - 1])) start -= 1
      while (end < text.length && asciiWord.test(text[end])) end += 1
    } else {
      while (start > 0 && !hardBoundary.test(text[start - 1]) && offset - start < 12) start -= 1
      while (end < text.length && !hardBoundary.test(text[end]) && end - offset < 14) end += 1
    }

    while (start < end && /\s/.test(text[start])) start += 1
    while (end > start && /\s/.test(text[end - 1])) end -= 1
    if (start >= end) return null

    const expanded = document.createRange()
    expanded.setStart(textNode, start)
    expanded.setEnd(textNode, end)
    return expanded
  }

  const rangeBetweenAnchorAndPoint = (anchor: Range, point: Range): Range | null => {
    const focus = point.cloneRange()
    focus.collapse(true)
    const anchorStart = anchor.cloneRange()
    anchorStart.collapse(true)
    const next = document.createRange()
    try {
      if (focus.compareBoundaryPoints(Range.START_TO_START, anchorStart) < 0) {
        next.setStart(focus.startContainer, focus.startOffset)
        next.setEnd(anchor.endContainer, anchor.endOffset)
      } else {
        next.setStart(anchor.startContainer, anchor.startOffset)
        next.setEnd(focus.startContainer, focus.startOffset)
      }
    } catch {
      return null
    }
    return next.collapsed ? anchor.cloneRange() : next
  }

  // Runs at most once per animation frame regardless of how many touchmove
  // events fired. This is the ONLY place that hit-tests and repaints during a
  // drag — no setState, no content-DOM mutation.
  const flushSelection = () => {
    const sel = customSelectionRef.current
    sel.rafId = null
    if (!sel.selecting || !sel.anchorRange) return
    const scrollerRect = scrollRef.current?.getBoundingClientRect()
    const hitY = scrollerRect
      ? Math.min(Math.max(sel.lastY, scrollerRect.top + 4), scrollerRect.bottom - 4)
      : sel.lastY
    const hitX = Math.min(Math.max(sel.lastX, 4), window.innerWidth - 4)
    const point = rangeFromPoint(hitX, hitY)
    const next = point ? rangeBetweenAnchorAndPoint(sel.anchorRange, point) : null
    if (!next) return
    sel.currentRange = next
    paintSelectionOverlay(next)
  }

  const scheduleSelectionFlush = () => {
    const sel = customSelectionRef.current
    if (sel.rafId == null) sel.rafId = requestAnimationFrame(flushSelection)
  }

  const cancelCustomLongPress = () => {
    if (customSelectionRef.current.longPressTimer) {
      clearTimeout(customSelectionRef.current.longPressTimer)
      customSelectionRef.current.longPressTimer = null
    }
  }

  const stopSelectionAutoScroll = () => {
    const sel = customSelectionRef.current
    sel.autoScrollV = 0
    if (sel.autoScrollRaf != null) {
      cancelAnimationFrame(sel.autoScrollRaf)
      sel.autoScrollRaf = null
    }
  }

  const stepSelectionAutoScroll = () => {
    const sel = customSelectionRef.current
    const scroller = scrollRef.current
    if (!sel.selecting || !scroller || sel.autoScrollV === 0) {
      sel.autoScrollRaf = null
      return
    }

    const before = scroller.scrollTop
    const max = scroller.scrollHeight - scroller.clientHeight
    const next = Math.min(Math.max(0, before + sel.autoScrollV), max)
    if (next !== before) {
      scroller.scrollTop = next
      sel.lockedScrollTop = next
      scheduleSelectionFlush()
    }
    sel.autoScrollRaf = requestAnimationFrame(stepSelectionAutoScroll)
  }

  const updateSelectionAutoScroll = (clientY: number) => {
    const sel = customSelectionRef.current
    const scroller = scrollRef.current
    if (!sel.selecting || !scroller) return

    const rect = scroller.getBoundingClientRect()
    const edge = Math.min(96, Math.max(56, rect.height * 0.16))
    let v = 0
    if (clientY < rect.top + edge) {
      const t = (rect.top + edge - clientY) / edge
      v = -Math.round(4 + t * 18)
    } else if (clientY > rect.bottom - edge) {
      const t = (clientY - (rect.bottom - edge)) / edge
      v = Math.round(4 + t * 18)
    }

    const max = scroller.scrollHeight - scroller.clientHeight
    if ((v < 0 && scroller.scrollTop <= 0) || (v > 0 && scroller.scrollTop >= max)) v = 0
    sel.autoScrollV = v
    if (v === 0) {
      if (sel.autoScrollRaf != null) {
        cancelAnimationFrame(sel.autoScrollRaf)
        sel.autoScrollRaf = null
      }
      return
    }
    if (sel.autoScrollRaf == null) {
      sel.autoScrollRaf = requestAnimationFrame(stepSelectionAutoScroll)
    }
  }

  const handleCustomSelectionTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || e.touches.length !== 1) return
    const target = e.target as HTMLElement
    if (target.closest('img, a, button, .selection-menu')) return
    const touch = e.touches[0]
    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      startedAt: Date.now(),
      tracking: true,
      startedInCodeBlock: Boolean(target.closest('pre, .epub-code-explain')),
      axis: 'pending',
      dragging: false,
    }
    customSelectionRef.current.startX = touch.clientX
    customSelectionRef.current.startY = touch.clientY
    customSelectionRef.current.lastX = touch.clientX
    customSelectionRef.current.lastY = touch.clientY
    customSelectionRef.current.selecting = false
    customSelectionRef.current.anchorRange = null
    cancelCustomLongPress()
    customSelectionRef.current.longPressTimer = setTimeout(() => {
      const sel = customSelectionRef.current
      const pointRange = rangeFromPoint(sel.lastX, sel.lastY)
      const anchorRange = pointRange ? expandRangeAtPoint(pointRange) : null
      if (!anchorRange) return
      sel.anchorRange = anchorRange.cloneRange()
      sel.currentRange = anchorRange.cloneRange()
      sel.selecting = true
      const scroller = scrollRef.current
      if (scroller) {
        sel.lockedScrollTop = scroller.scrollTop
        sel.previousOverflowY = scroller.style.overflowY
        scroller.style.overflowY = 'hidden'
      }
      // Hide the toolbar during the drag; it reappears on touchend.
      setSelToolbar(null)
      contentRef.current?.classList.add('epub-selecting')
      paintSelectionOverlay(anchorRange)
      // Light haptic on selection start, where supported.
      navigator.vibrate?.(10)
    }, 350)
  }

  const handleCustomSelectionTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || e.touches.length !== 1) return
    const touch = e.touches[0]
    if (swipeRef.current.tracking) {
      swipeRef.current.lastX = touch.clientX
      swipeRef.current.lastY = touch.clientY
    }
    const sel = customSelectionRef.current
    if (!sel.selecting) {
      if (updateSwipeDrag(e, touch.clientX, touch.clientY)) return
      const dx = touch.clientX - sel.startX
      const dy = touch.clientY - sel.startY
      if (Math.hypot(dx, dy) > 8) cancelCustomLongPress()
      return
    }
    // Selecting: block native scroll and do the bare minimum on this high-freq
    // path — stash the latest point, coalesce the real work into one rAF.
    e.preventDefault()
    if (scrollRef.current && sel.lockedScrollTop != null) {
      scrollRef.current.scrollTop = sel.lockedScrollTop
    }
    sel.lastX = touch.clientX
    sel.lastY = touch.clientY
    updateSelectionAutoScroll(touch.clientY)
    scheduleSelectionFlush()
  }

  const handleCustomSelectionTouchEnd = (e: React.TouchEvent) => {
    cancelCustomLongPress()
    const sel = customSelectionRef.current
    if (sel.rafId != null) {
      cancelAnimationFrame(sel.rafId)
      sel.rafId = null
    }
    stopSelectionAutoScroll()
    if (scrollRef.current && sel.previousOverflowY != null) {
      scrollRef.current.style.overflowY = sel.previousOverflowY
    }
    sel.lockedScrollTop = null
    sel.previousOverflowY = null
    contentRef.current?.classList.remove('epub-selecting')
    if (sel.selecting) {
      e.preventDefault()
      sel.suppressClickUntil = Date.now() + 450
      const range = sel.currentRange || sel.anchorRange
      sel.selecting = false
      sel.anchorRange = null
      if (range) finalizeMobileSelection(range)
      else clearSelectionState()
    } else if (finishSwipeIfNeeded(e.type === 'touchcancel')) {
      e.preventDefault()
    } else {
      sel.selecting = false
      sel.anchorRange = null
    }
  }

  // Listen for text selection changes. We wait until selection settles before
  // showing the toolbar, otherwise iOS handle dragging makes the toolbar jitter.
  useEffect(() => {
    const updateSelectionToolbar = () => {
      if (isMobile) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        if (contentRef.current?.querySelector('mark.selection-preview') && selInfoRef.current) return
        lastSelectionKeyRef.current = ''
        setSelToolbar(null)
        return
      }
      const text = sel.toString().trim()
      if (!text) {
        lastSelectionKeyRef.current = ''
        setSelToolbar(null)
        return
      }
      const content = contentRef.current
      if (!content || !content.contains(sel.anchorNode)) {
        lastSelectionKeyRef.current = ''
        setSelToolbar(null)
        return
      }
      const range = sel.getRangeAt(0)
      const selectionKey = text
      if (selectionKey === lastSelectionKeyRef.current) return
      showSelectionForRange(range.cloneRange())
    }

    const handleSelectionChange = () => {
      if (selectionSettleTimerRef.current) clearTimeout(selectionSettleTimerRef.current)
      selectionSettleTimerRef.current = setTimeout(updateSelectionToolbar, 120)
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (selectionSettleTimerRef.current) clearTimeout(selectionSettleTimerRef.current)
    }
  }, [isMobile])

  useEffect(() => {
    const preventContentContextMenu = (event: Event) => {
      const content = contentRef.current
      if (content && event.target instanceof Node && content.contains(event.target)) {
        event.preventDefault()
      }
    }
    document.addEventListener('contextmenu', preventContentContextMenu, true)
    return () => {
      document.removeEventListener('contextmenu', preventContentContextMenu, true)
    }
  }, [])

  useEffect(() => {
    const preventScrollWhileSelecting = (event: TouchEvent) => {
      if (!customSelectionRef.current.selecting) return
      event.preventDefault()
    }
    document.addEventListener('touchmove', preventScrollWhileSelecting, { capture: true, passive: false })
    return () => {
      document.removeEventListener('touchmove', preventScrollWhileSelecting, true)
    }
  }, [])

  const handleExplainSelection = () => {
    const info = selInfoRef.current
    clearSelectionState()
    if (info) onTextSelect(info.text, info.context, info.rect)
  }

  const handleExplainAndHighlightSelection = () => {
    const info = selInfoRef.current
    clearSelectionState()
    if (info) onExplainAndHighlight(info.text, withHighlightMeta(info.context, DEFAULT_HIGHLIGHT_COLOR), info.rect)
  }

  // Click an inlined image to ask the vision model to explain it.
  const handleClick = (e: React.MouseEvent) => {
    if (Date.now() < customSelectionRef.current.suppressClickUntil) {
      e.stopPropagation()
      return
    }
    const target = e.target as HTMLElement
    const mark = target.closest('mark[data-highlight-id]') as HTMLElement | null
    if (mark) {
      const id = mark.getAttribute('data-highlight-id')
      const highlight = highlights?.find((h) => h.id === id)
      if (highlight) {
        onHighlightSelect?.(highlight)
        e.stopPropagation()
        return
      }
    }
    const codeButton = target.closest('[data-code-explain]') as HTMLButtonElement | null
    if (codeButton) {
      const shell = codeButton.closest('.epub-code-shell')
      const pre = shell?.querySelector('pre') as HTMLElement | null
      if (pre && onCodeSelect) {
        const fullCode = (pre.textContent || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
        const originalLines = fullCode.split('\n')
        let code = originalLines.slice(0, 200).join('\n')
        if (code.length > 16000) code = code.slice(0, 16000)
        onCodeSelect({
          code,
          language: detectCodeLanguage(pre),
          contextBefore: nearbyText(shell, 'before'),
          contextAfter: nearbyText(shell, 'after'),
          originalLineCount: originalLines.length,
          truncated: originalLines.length > 200 || fullCode.length > 16000,
        })
        e.stopPropagation()
        return
      }
    }
    if (target.tagName !== 'IMG') {
      if (!window.getSelection()?.toString()) onToggleChrome?.()
      return
    }
    if (!onImageSelect) return
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

  const handleRootClickCapture = (e: React.MouseEvent) => {
    if (Date.now() < customSelectionRef.current.suppressClickUntil) {
      e.stopPropagation()
      return
    }
    if (!selToolbar) return
    const target = e.target as Node
    if (toolbarRef.current?.contains(target)) return
    clearSelectionState()
    e.stopPropagation()
  }

  return (
    <div
      ref={swipeRootRef}
      className="records-epub-reader relative flex h-full flex-col overflow-hidden transition-[padding] duration-200"
      style={
        isMobile && !chromeVisible
          ? { paddingTop: 'calc(max(env(safe-area-inset-top), 44px) + 0.5rem)' }
          : undefined
      }
      onClickCapture={handleRootClickCapture}
    >
      <div ref={prevPreviewRef} className="epub-swipe-neighbor epub-swipe-neighbor--prev" aria-hidden>
        {prevChapter && (
          <>
            <section className="reader-track-intro">
              <div className="reader-track-intro__meta">
                <strong>TRACK {String(idx).padStart(2, '0')}</strong>
                <span>PREVIOUS SIDE</span>
              </div>
              <h1>{prevChapter.title}</h1>
              <p>{bookTitle}</p>
            </section>
            <div ref={prevPreviewContentRef} className="epub-content records-epub-content mx-auto max-w-3xl px-8 py-8" />
          </>
        )}
      </div>
      <div ref={nextPreviewRef} className="epub-swipe-neighbor epub-swipe-neighbor--next" aria-hidden>
        {nextChapter && (
          <>
            <section className="reader-track-intro">
              <div className="reader-track-intro__meta">
                <strong>TRACK {String(idx + 2).padStart(2, '0')}</strong>
                <span>NEXT SIDE</span>
              </div>
              <h1>{nextChapter.title}</h1>
              <p>{bookTitle}</p>
            </section>
            <div ref={nextPreviewContentRef} className="epub-content records-epub-content mx-auto max-w-3xl px-8 py-8" />
          </>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`epub-container flex-1 ${pagedMode ? 'epub-container--paged overflow-hidden' : 'overflow-y-auto'}`}
        aria-label={pagedMode ? `epub-page-${pageIndex + 1}-of-${pageCount}` : 'epub-scroll-reader'}
        data-page-index={pageIndex + 1}
        data-page-count={pageCount}
        onTouchStart={handleCustomSelectionTouchStart}
        onTouchMove={handleCustomSelectionTouchMove}
        onTouchEnd={handleCustomSelectionTouchEnd}
        onTouchCancel={handleCustomSelectionTouchEnd}
      >
        <div ref={pageTrackRef} className={pagedMode ? 'epub-page-track' : undefined}>
          {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">加载章节中...</div>
        ) : (
          <>
            <section className="reader-track-intro">
              <span className="reader-track-intro__ghost">{String(chapterNumber).padStart(2, '0')}</span>
              <div className="reader-track-intro__meta">
                <strong>TRACK {String(chapterNumber).padStart(2, '0')}</strong>
                <span>RUNTIME {formatPlaybackTime(totalSeconds)}</span>
              </div>
              <h1>{chapterTitle || bookTitle}</h1>
              <p>{bookTitle} · {chapters.length} TRACKS</p>
              {onPreview && (
                <button type="button" onClick={onPreview} className="reader-preview" aria-label="快速浏览本章">
                  <span>PREVIEW</span>
                  <span><b>先试听本章主旨</b><small>浓缩核心知识 · 留下一道追问</small></span>
                  <time>3:00</time>
                </button>
              )}
            </section>
            <div
              ref={contentRef}
              className={`epub-content epub-content--images records-epub-content mx-auto max-w-3xl px-8 py-8 ${
                isMobile ? 'epub-content--custom-select' : ''
              }`}
              onClick={handleClick}
              onContextMenu={(event) => event.preventDefault()}
              />
          </>
          )}
        </div>
      </div>

      {/* Mobile selection preview layer — pooled rects, never in the content flow. */}
      <div ref={selectionOverlayRef} className="epub-selection-overlay" aria-hidden />

      {selToolbar && (
        <div
          ref={toolbarRef}
          style={{ position: 'fixed', top: selToolbar.top, left: selToolbar.left, zIndex: 1000 }}
          className="selection-menu selection-menu--compact"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
        >
          <div className="selection-menu__actions">
            <button type="button" className="selection-menu__action" onClick={handleExplainSelection}>
              <Sparkles className="h-5 w-5" />
              <span>AI 解释</span>
            </button>
            <button type="button" className="selection-menu__action" onClick={handleExplainAndHighlightSelection}>
              <Sparkles className="h-5 w-5" />
              <span>解释并高亮</span>
            </button>
          </div>
        </div>
      )}

      <div
        className={`reader-player ${
          isMobile ? `absolute inset-x-0 bottom-0 z-20 ${chromeVisible ? 'translate-y-0' : 'translate-y-full'}` : ''
        }`}
        style={isMobile ? { paddingBottom: 'calc(max(env(safe-area-inset-bottom), 18px) + 0.5rem)' } : undefined}
      >
        <div className="reader-player__scrub"><i style={{ width: `${scrollFraction * 100}%` }} /></div>
        <div className="reader-player__inner">
          <time>{formatPlaybackTime(elapsedSeconds)}</time>
          <div className="reader-player__controls">
            <button onClick={goPrev} disabled={idx <= 0} aria-label="上一章"><SkipBack /></button>
            <button onClick={onToggleToc} className="reader-player__track" aria-label="目录">
              <List />
              {String(idx + 1).padStart(2, '0')} / {String(chapters.length).padStart(2, '0')}
            </button>
            <button onClick={goNext} disabled={idx >= chapters.length - 1} aria-label="下一章"><SkipForward /></button>
          </div>
          <time>{formatPlaybackTime(totalSeconds)}</time>
        </div>
      </div>

      <div
        className={`reader-page-bar ${
          isMobile ? `absolute inset-x-0 bottom-0 z-20 ${chromeVisible ? 'translate-y-0' : 'translate-y-full'}` : ''
        }`}
        style={isMobile ? { paddingBottom: 'calc(max(env(safe-area-inset-bottom), 18px) + 0.5rem)' } : undefined}
      >
        <button
          onClick={goPrev}
          disabled={idx <= 0}
          className="reader-page-button"
          aria-label="上一章"
        >
          上一章
        </button>
        <button
          onClick={onToggleToc}
          className="reader-page-button reader-page-button--toc"
          aria-label="目录"
        >
          <List className="h-4 w-4" />
          <span>目录</span>
        </button>
        <button
          onClick={goNext}
          disabled={idx >= chapters.length - 1}
          className="reader-page-button"
          aria-label="下一章"
        >
          下一章
        </button>
      </div>
    </div>
  )
}
