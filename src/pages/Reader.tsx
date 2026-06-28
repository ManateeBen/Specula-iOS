import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  History,
} from 'lucide-react'
import EpubReader from '../components/epub/EpubReader'
import ChapterToc from '../components/ChapterToc'
import HighlightPopover from '../components/HighlightPopover'
import HighlightCard from '../components/HighlightCard'
import ImageExplanationPopover from '../components/ImageExplanationPopover'
import type { Book, Chapter, Highlight, ImageSelectionInfo } from '../types'
import {
  buildWeakPointIndexMap,
  getWeakPointIndex,
} from '../utils/weakPointStyle'

// Lazy so the PDF vendor chunk only loads for PDF books.
const PdfReader = lazy(() => import('../components/pdf/PdfReader'))

const MIN_READABLE_CHAPTER_CHARS = 80

function normalizeChapterText(text: string): string {
  return text.replace(/\s+/g, '')
}

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const [searchParams] = useSearchParams()
  const deepLinkChapterId = searchParams.get('chapterId')
  const deepLinkHighlight = searchParams.get('highlight')

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
    setImageSelection(null)
    setActiveHighlight(null)
    setSelection({ text, context, rect, action: 'explain' })
  }, [])

  const handleExplainAndHighlight = useCallback((text: string, context: string, rect: DOMRect) => {
    setImageSelection(null)
    setActiveHighlight(null)
    setSelection({ text, context, rect, action: 'explain-highlight' })
  }, [])

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
            >
              {tocOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
            </button>
            <Link to="/" className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
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
                <Link
                  to={`/quiz/${bookId}/${activeChapterId}`}
                  className="btn-secondary min-h-10 px-2.5 py-1.5 text-[0px] sm:px-3 sm:text-xs"
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  章节测验
                </Link>
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

        <div className="relative flex-1 overflow-hidden">
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
