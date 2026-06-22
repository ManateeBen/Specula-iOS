import { useEffect, useRef, useState, useMemo } from 'react'
import { Highlighter, Sparkles } from 'lucide-react'
import type { Chapter, Highlight, ImageSelectionInfo } from '../../types'
import { buildWeakPointIndexMap, getWeakPointColorSlot } from '../../utils/weakPointStyle'

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
  excerpt: string,
  source: 'user' | 'quiz'
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
  onChapterChange: (chapterId: string) => void
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
  onChapterChange,
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

  // Scroll fraction (0–1) to restore once the next chapter HTML is painted.
  // Seeded from saved progress for the very first chapter only.
  const restorePosRef = useRef<number | null>(
    initialPosition && !Number.isNaN(parseFloat(initialPosition)) ? parseFloat(initialPosition) : null
  )
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
      setHtml(h || '<p style="opacity:.6">本章无可显示内容</p>')
      setLoading(false)
      // Restore scroll after the new content has been laid out.
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el) return
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
      const range = locateHighlight(el, h.selectedText, h.source)
      const wpIndex = h.source === 'quiz' ? wpIndexMap.get(h.id) : undefined
      const ok = range
        ? h.source === 'quiz'
          ? markRange(range, 'quiz-highlight', {
              topic: h.weakPointTopic || '',
              wpIndex,
              colorSlot: wpIndex ? getWeakPointColorSlot(wpIndex) : undefined,
            })
          : markRange(range, 'user-highlight')
        : false
      if (!ok) unlocated.push(h.id)
    }
    onUnlocatedChange?.(unlocated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, chapterHighlights, loading])

  // Deep link: scroll to (and briefly flash) the excerpt once the chapter renders.
  useEffect(() => {
    if (!highlightExcerpt || loading) return
    const el = contentRef.current
    if (!el) return
    const range = locateExcerpt(el, highlightExcerpt)
    const target = (range?.startContainer.parentElement as HTMLElement) || null
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('deeplink-flash')
      window.setTimeout(() => target.classList.remove('deeplink-flash'), 2400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlightExcerpt, loading, chapterHighlights])

  // Persist intra-chapter scroll position as a fraction (debounced).
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el || loading) return
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

  const handleMouseUp = () => {
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
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const contextEl = range.commonAncestorContainer.parentElement
    const context = contextEl?.textContent?.slice(0, 500) || ''
    // Stash the live range/info so the toolbar actions can use them after click.
    selRangeRef.current = range.cloneRange()
    selInfoRef.current = { text, context, rect }
    setSelToolbar({ top: rect.top - 44, left: rect.left })
  }

  const handleManualHighlight = async () => {
    const info = selInfoRef.current
    if (!info) return
    window.getSelection()?.removeAllRanges()
    setSelToolbar(null)
    try {
      await window.specula.highlights.create({
        bookId,
        chapterId: currentChapterId,
        selectedText: info.text,
        context: info.context,
        aiExplanation: null,
        teachingMode: null,
        source: 'user',
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
    if (target.tagName !== 'IMG') return
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

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} onMouseUp={handleMouseUp} onScroll={handleScroll} className="epub-container flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">加载章节中...</div>
        ) : (
          <div
            ref={contentRef}
            className="epub-content epub-content--images mx-auto max-w-3xl px-8 py-8"
            onClick={handleClick}
          />
        )}
      </div>

      {selToolbar && (
        <div
          style={{ position: 'fixed', top: selToolbar.top, left: selToolbar.left, zIndex: 1000 }}
          className="flex overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            onClick={handleManualHighlight}
            className="flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Highlighter className="h-3.5 w-3.5 text-yellow-500" />
            高亮
          </button>
          <div className="w-px bg-gray-200 dark:bg-gray-700" />
          <button
            onClick={handleExplainSelection}
            className="flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Sparkles className="h-3.5 w-3.5 text-specula-500" />
            AI 解释
          </button>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-t border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
        <button onClick={goPrev} disabled={idx <= 0} className="btn-secondary py-1.5 text-xs">
          上一章
        </button>
        <span className="max-w-md truncate px-2 text-xs text-gray-500">
          {chapters[idx]?.title || ''}
        </span>
        <button
          onClick={goNext}
          disabled={idx >= chapters.length - 1}
          className="btn-secondary py-1.5 text-xs"
        >
          下一章
        </button>
      </div>
    </div>
  )
}
