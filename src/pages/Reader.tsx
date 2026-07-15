import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ClipboardList,
  ChevronRight,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
  History,
  Check,
} from 'lucide-react'
import EpubReader from '../components/epub/EpubReader'
import ChapterToc from '../components/ChapterToc'
import HighlightPopover from '../components/HighlightPopover'
import HighlightCard from '../components/HighlightCard'
import ImageExplanationPopover from '../components/ImageExplanationPopover'
import type { Book, Chapter, ChapterDigest, Highlight, ImageSelectionInfo } from '../types'
import {
  buildWeakPointIndexMap,
  getWeakPointIndex,
} from '../utils/weakPointStyle'

// Lazy so the PDF vendor chunk only loads for PDF books.
const PdfReader = lazy(() => import('../components/pdf/PdfReader'))

const MIN_READABLE_CHAPTER_CHARS = 80
const QUICK_BROWSE_ENABLED = import.meta.env.VITE_ENABLE_QUICK_BROWSE !== 'false'

function normalizeChapterText(text: string): string {
  return text.replace(/\s+/g, '')
}

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const deepLinkChapterId = searchParams.get('chapterId')
  const deepLinkHighlight = searchParams.get('highlight')
  const gapId = searchParams.get('gapId')

  const [book, setBook] = useState<Book | null>(null)
  const [fileData, setFileData] = useState<Uint8Array | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [tocOpen, setTocOpen] = useState(!isMobile)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [pdfJumpChapterId, setPdfJumpChapterId] = useState<string | null>(null)
  const [, setUnlocatedIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState(false)
  const [selection, setSelection] = useState<{
    text: string
    context: string
    rect: DOMRect
    action: 'explain' | 'explain-highlight'
  } | null>(null)
  const [imageSelection, setImageSelection] = useState<ImageSelectionInfo | null>(null)
  const [activeHighlight, setActiveHighlight] = useState<Highlight | null>(null)
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null)
  const [initialPosition, setInitialPosition] = useState<string>('')
  const [activeGap, setActiveGap] = useState<ChapterDigest | null>(null)
  const gapOpenedAt = useRef(0)
  const quickBrowseExposureTracked = useRef(false)

  useEffect(() => {
    const updateMobileState = () => {
      const nextIsMobile = window.innerWidth < 768
      setIsMobile(nextIsMobile)
      setChromeVisible((visible) => (nextIsMobile ? visible : true))
      if (nextIsMobile) {
        setTocOpen(false)
      } else {
        setTocOpen(true)
      }
    }
    updateMobileState()
    window.addEventListener('resize', updateMobileState)
    return () => window.removeEventListener('resize', updateMobileState)
  }, [])

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    const load = async () => {
      setReady(false)
      setError('')
      try {
        const b = await window.specula.books.get(bookId)
        if (cancelled) return
        if (!b) {
          setError('未找到该书籍')
          return
        }
        setBook(b)
        // Only the PDF reader needs the raw bytes; EPUB renders chapter HTML via IPC.
        if (b.format === 'pdf') {
          const data = await window.specula.books.getFileData(bookId)
          if (cancelled) return
          setFileData(data)
        }
        const chs = await window.specula.chapters.listByBook(bookId)
        if (cancelled) return
        setChapters(chs)

        const progress = await window.specula.books.getProgress(bookId)
        if (cancelled) return

        // A deep link (?chapterId=&highlight=) takes precedence over saved progress.
        if (deepLinkChapterId) {
          setCurrentChapterId(deepLinkChapterId)
          const ch = chs.find((c) => c.id === deepLinkChapterId)
          if (b.format === 'pdf' && ch) setInitialPosition(ch.startRef)
          else setInitialPosition('')
        } else {
          let nextChapterId = progress?.chapterId ?? null
          let nextPosition = progress?.position ?? ''

          if (b.format === 'epub' && chs.length > 1) {
            const progressChapter = chs.find((c) => c.id === progress?.chapterId)
            const shouldCheckStart =
              !progress?.chapterId ||
              (progressChapter?.orderIndex === 0 && (!progress.position || progress.position === '0'))

            if (shouldCheckStart) {
              for (const ch of chs) {
                const text = await window.specula.chapters.getContent(ch.id)
                if (cancelled) return
                if (normalizeChapterText(text).length >= MIN_READABLE_CHAPTER_CHARS) {
                  nextChapterId = ch.id
                  nextPosition = '0'
                  break
                }
              }
            }
          }

          setCurrentChapterId(nextChapterId)
          setInitialPosition(nextPosition)
        }

        const hl = await window.specula.highlights.listByBook(bookId)
        if (cancelled) return
        setHighlights(hl)
        setReady(true)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载书籍失败')
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, deepLinkChapterId])

  useEffect(() => {
    if (!bookId || !gapId) {
      setActiveGap(null)
      return
    }
    let cancelled = false
    window.specula.quickBrowse.getProgress(bookId).then((quickProgress) => {
      if (cancelled) return
      const gap = quickProgress.digests.find((item) => item.id === gapId && item.status === 'gap') || null
      setActiveGap(gap)
      gapOpenedAt.current = Date.now()
    })
    return () => {
      cancelled = true
    }
  }, [bookId, gapId])

  useEffect(() => {
    if (!QUICK_BROWSE_ENABLED || !bookId || chapters.length === 0 || quickBrowseExposureTracked.current) return
    quickBrowseExposureTracked.current = true
    void window.specula.quickBrowse.track(bookId, 'quick_browse_entry_exposed', undefined, { chapterCount: chapters.length })
  }, [bookId, chapters.length])

  // Debounced progress saving: page turns / scrolls happen rapidly, so batch
  // them into a single write and flush any pending write on unmount.
  const pendingProgress = useRef<{ chapterId: string | null; position: string } | null>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushProgress = useCallback(() => {
    if (progressTimer.current) {
      clearTimeout(progressTimer.current)
      progressTimer.current = null
    }
    const p = pendingProgress.current
    if (p && bookId) {
      pendingProgress.current = null
      void window.specula.books.saveProgress({ bookId, chapterId: p.chapterId, position: p.position })
    }
  }, [bookId])

  const handleProgress = useCallback(
    (chapterId: string | null, position: string) => {
      setCurrentChapterId(chapterId)
      pendingProgress.current = { chapterId, position }
      if (progressTimer.current) clearTimeout(progressTimer.current)
      progressTimer.current = setTimeout(flushProgress, 600)
    },
    [flushProgress]
  )

  useEffect(() => {
    return () => flushProgress()
  }, [flushProgress])

  const handleTextSelect = useCallback((text: string, context: string, rect: DOMRect) => {
    if (book?.format === 'pdf' && book.pdfTextStatus !== 'text') {
      setNotice(book.pdfAiUnsupportedReason || '该 PDF 暂不支持 AI 功能，开发中')
      return
    }
    setImageSelection(null)
    setActiveHighlight(null)
    setSelection({ text, context, rect, action: 'explain' })
  }, [book])

  const handleExplainAndHighlight = useCallback((text: string, context: string, rect: DOMRect) => {
    if (book?.format === 'pdf' && book.pdfTextStatus !== 'text') {
      setNotice(book.pdfAiUnsupportedReason || '该 PDF 暂不支持 AI 功能，开发中')
      return
    }
    setImageSelection(null)
    setActiveHighlight(null)
    setSelection({ text, context, rect, action: 'explain-highlight' })
  }, [book])

  const handleImageSelect = useCallback((info: ImageSelectionInfo) => {
    setSelection(null)
    setActiveHighlight(null)
    setImageSelection(info)
  }, [])

  const refreshHighlights = async () => {
    if (!bookId) return
    const hl = await window.specula.highlights.listByBook(bookId)
    setHighlights(hl)
  }

  const activeChapterId = currentChapterId ?? chapters[0]?.id ?? null
  const currentChapter = chapters.find((c) => c.id === activeChapterId)
  const chapterHighlights = highlights.filter((h) => h.chapterId === activeChapterId)
  const wpIndexMap = buildWeakPointIndexMap(chapterHighlights)
  const activeWeakPointIndex = activeHighlight ? getWeakPointIndex(activeHighlight, wpIndexMap) : null
  const pdfAiDisabled = book?.format === 'pdf' && book.pdfTextStatus !== 'text'
  const pdfAiDisabledMessage = pdfAiDisabled
    ? book.pdfAiUnsupportedReason || '该 PDF 暂不支持 AI 解释、章节测验和薄弱点分析，开发中'
    : ''

  const handleTocSelect = useCallback(
    (chapterId: string) => {
      setCurrentChapterId(chapterId)
      if (isMobile) setTocOpen(false)
      if (book?.format === 'pdf') {
        setPdfJumpChapterId(chapterId)
      }
    },
    [book?.format, isMobile]
  )

  const handleChapterChange = useCallback((chapterId: string) => {
    setCurrentChapterId(chapterId)
  }, [])

  const handleRepairGap = useCallback(async () => {
    if (!bookId || !activeGap) return
    await window.specula.quickBrowse.track(bookId, 'quick_browse_gap_reading_completed', activeGap.chapterId, {
      dwellMs: Math.max(0, Date.now() - gapOpenedAt.current),
    })
    await window.specula.quickBrowse.repair(bookId, activeGap.id)
    window.location.hash = `/quick-browse/${bookId}/${activeGap.chapterId}`
  }, [activeGap, bookId])
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <Link to="/" className="btn-secondary">
          返回书库
        </Link>
      </div>
    )
  }

  if (!book || !ready || (book.format === 'pdf' && !fileData)) {
    return <div className="flex h-full items-center justify-center text-gray-500">加载中...</div>
  }

  return (
    <div className="relative flex h-full">
      {tocOpen && isMobile && (
        <div
          className="absolute inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => {
            setTocOpen(false)
          }}
        />
      )}
      {tocOpen && (
        <aside className="absolute inset-y-0 left-0 z-30 w-64 max-w-[85vw] shrink-0 overflow-hidden border-r border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900 md:relative md:z-auto md:w-56 md:max-w-none md:shadow-none">
          <ChapterToc
            chapters={chapters}
            currentChapterId={activeChapterId}
            onSelect={handleTocSelect}
          />
        </aside>
      )}

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div
          className={`z-10 flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 sm:px-4 ${
            isMobile
              ? `absolute inset-x-0 top-0 transition-transform duration-200 ${chromeVisible ? 'translate-y-0' : '-translate-y-full'}`
              : ''
          }`}
          style={isMobile ? { paddingTop: 'calc(max(env(safe-area-inset-top), 54px) + 0.5rem)' } : undefined}
        >
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              onClick={() => setTocOpen(!tocOpen)}
              className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
              title={tocOpen ? '隐藏目录' : '显示目录'}
              aria-label="reader-toggle-toc"
            >
              {tocOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
            </button>
            <Link to="/" className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="reader-back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{book.title}</h2>
              {currentChapter && (
                <p className="truncate text-xs text-gray-500">{currentChapter.title}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {activeChapterId && (
              <>
                {pdfAiDisabled ? (
                  <button
                    type="button"
                    disabled
                    title={pdfAiDisabledMessage}
                    className="btn-secondary min-h-10 cursor-not-allowed px-2.5 py-1.5 text-[0px] opacity-60 sm:px-3 sm:text-xs"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    章节测验
                  </button>
                ) : (
                  <Link
                    to={`/quiz/${bookId}/${activeChapterId}`}
                    className="btn-secondary min-h-10 px-2.5 py-1.5 text-[0px] sm:px-3 sm:text-xs"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    章节测验
                  </Link>
                )}
                <Link
                  to={`/quiz-history/${bookId}/${activeChapterId}`}
                  className="btn-secondary min-h-10 px-2.5 py-1.5 text-[0px] sm:px-3 sm:text-xs"
                >
                  <History className="h-3.5 w-3.5" />
                  历史
                </Link>
              </>
            )}
          </div>
        </div>

        {(pdfAiDisabledMessage || notice) && (
          <div className="z-10 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {notice || pdfAiDisabledMessage}
          </div>
        )}

        {QUICK_BROWSE_ENABLED && !activeGap && chapters.length > 0 && !pdfAiDisabled && (
          <button
            type="button"
            onClick={() => {
              if (activeChapterId) navigate(`/quick-browse/${book.id}/${activeChapterId}`)
              queueMicrotask(() => void window.specula.quickBrowse.track(book.id, 'quick_browse_entry_clicked'))
            }}
            className={`z-10 flex shrink-0 items-center gap-3 rounded-lg border border-specula-200 bg-specula-50/95 px-4 py-3 text-left shadow-sm backdrop-blur transition dark:border-specula-800 dark:bg-specula-950/80 ${isMobile ? `absolute inset-x-3 ${!chromeVisible ? 'pointer-events-none -translate-y-3 opacity-0' : ''}` : 'mx-3 mt-3'}`}
            style={isMobile ? { top: 'calc(max(env(safe-area-inset-top), 54px) + 4.25rem)' } : undefined}
            aria-label="快速浏览本章"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-specula-600 text-white">
              <Zap className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-specula-900 dark:text-specula-100">快速浏览本章</span>
              <span className="mt-0.5 block truncate text-xs text-specula-700 dark:text-specula-300">3 分钟抓住主旨 · 顺便测测你真懂了多少</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-specula-500" />
          </button>
        )}

        {activeGap && activeGap.chapterId === activeChapterId && (
          <div
            role="region"
            className={`z-10 shrink-0 rounded-lg border border-dashed border-red-400 bg-red-50/95 px-4 py-3 dark:border-red-700 dark:bg-red-950/60 ${isMobile ? 'absolute inset-x-3' : 'mx-3 mt-3'}`}
            style={isMobile ? { top: 'calc(max(env(safe-area-inset-top), 54px) + 4.25rem)' } : undefined}
            aria-label="认知缺口问题钉"
          >
            <p className="text-xs font-semibold text-red-700 dark:text-red-300">你带着一个问题来</p>
            <p className="mt-1 text-sm font-semibold leading-6">{activeGap.question}</p>
            <button onClick={() => void handleRepairGap()} className="mt-3 min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white active:bg-red-700">
              <Check className="mr-1 inline h-4 w-4" />
              我搞懂了，修复缺口
            </button>
          </div>
        )}

        <div
          className="relative flex-1 overflow-hidden"
          style={isMobile && activeGap ? { marginTop: 'calc(max(env(safe-area-inset-top), 54px) + 13rem)' } : undefined}
        >
          {book.format === 'epub' ? (
            <EpubReader
              bookId={book.id}
              chapters={chapters}
              chapterId={activeChapterId}
              chromeVisible={chromeVisible}
              onChapterChange={handleChapterChange}
              onToggleChrome={() => setChromeVisible((visible) => !visible)}
              initialPosition={initialPosition}
              highlightExcerpt={deepLinkHighlight}
              gapAnchorExcerpt={activeGap?.chapterId === activeChapterId ? activeGap.answerAnchor : null}
              highlights={highlights}
              onProgress={handleProgress}
              onTextSelect={handleTextSelect}
              onExplainAndHighlight={handleExplainAndHighlight}
              onHighlightSelect={setActiveHighlight}
              onImageSelect={handleImageSelect}
              onUnlocatedChange={setUnlocatedIds}
              onToggleToc={() => setTocOpen((open) => !open)}
            />
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-gray-500">加载阅读器...</div>
              }
            >
              <PdfReader
                data={fileData!}
                chapters={chapters}
                initialPosition={initialPosition}
                jumpToChapterId={pdfJumpChapterId}
                onJumpComplete={() => setPdfJumpChapterId(null)}
                onProgress={handleProgress}
                onTextSelect={handleTextSelect}
                onImageSelect={handleImageSelect}
              />
            </Suspense>
          )}

          {selection && bookId && (
            <HighlightPopover
              selection={selection}
              bookId={bookId}
              chapterId={activeChapterId}
              bookTitle={book.title}
              chapterTitle={currentChapter?.title}
              action={selection.action}
              onClose={() => setSelection(null)}
              onSaved={refreshHighlights}
            />
          )}

          {activeHighlight && (
            <HighlightCard
              highlight={activeHighlight}
              weakPointIndex={activeWeakPointIndex}
              onClose={() => setActiveHighlight(null)}
              onDelete={async (id) => {
                await window.specula.highlights.delete(id)
                setActiveHighlight(null)
                await refreshHighlights()
              }}
            />
          )}

          {imageSelection && bookId && (
            <ImageExplanationPopover
              selection={imageSelection}
              bookId={bookId}
              chapterId={activeChapterId}
              bookTitle={book.title}
              chapterTitle={currentChapter?.title}
              onClose={() => setImageSelection(null)}
              onSaved={refreshHighlights}
            />
          )}
        </div>
      </div>

    </div>
  )
}
