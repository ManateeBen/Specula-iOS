import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Highlighter,
  ClipboardList,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  AlertTriangle,
  History,
} from 'lucide-react'
import EpubReader from '../components/epub/EpubReader'
import ChapterToc from '../components/ChapterToc'
import HighlightPopover from '../components/HighlightPopover'
import ImageExplanationPopover from '../components/ImageExplanationPopover'
import type { Book, Chapter, Highlight, ImageSelectionInfo } from '../types'
import {
  buildWeakPointIndexMap,
  getWeakPointIndex,
  getWeakPointSidebarStyle,
  sortHighlightsForDisplay,
} from '../utils/weakPointStyle'

// Lazy so the PDF vendor chunk only loads for PDF books.
const PdfReader = lazy(() => import('../components/pdf/PdfReader'))

type HighlightFilter = 'all' | 'user' | 'quiz'

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
  const [notesOpen, setNotesOpen] = useState(!isMobile)
  const [chromeVisible, setChromeVisible] = useState(!isMobile)
  const [pdfJumpChapterId, setPdfJumpChapterId] = useState<string | null>(null)
  const [highlightFilter, setHighlightFilter] = useState<HighlightFilter>('all')
  const [unlocatedIds, setUnlocatedIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [selection, setSelection] = useState<{
    text: string
    context: string
    rect: DOMRect
  } | null>(null)
  const [imageSelection, setImageSelection] = useState<ImageSelectionInfo | null>(null)
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null)
  const [initialPosition, setInitialPosition] = useState<string>('')

  useEffect(() => {
    const updateMobileState = () => {
      const nextIsMobile = window.innerWidth < 768
      setIsMobile(nextIsMobile)
      setChromeVisible((visible) => (nextIsMobile ? visible : true))
      if (nextIsMobile) {
        setTocOpen(false)
        setNotesOpen(false)
      } else {
        setTocOpen(true)
        setNotesOpen(true)
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
        } else if (progress) {
          setCurrentChapterId(progress.chapterId)
          setInitialPosition(progress.position)
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
    setSelection({ text, context, rect })
  }, [])

  const handleImageSelect = useCallback((info: ImageSelectionInfo) => {
    setSelection(null)
    setImageSelection(info)
  }, [])

  const refreshHighlights = async () => {
    if (!bookId) return
    const hl = await window.specula.highlights.listByBook(bookId)
    setHighlights(hl)
  }

  const activeChapterId = currentChapterId ?? chapters[0]?.id ?? null
  const currentChapter = chapters.find((c) => c.id === activeChapterId)

  const handleTocSelect = useCallback(
    (chapterId: string) => {
      setCurrentChapterId(chapterId)
      if (book?.format === 'pdf') {
        setPdfJumpChapterId(chapterId)
      }
    },
    [book?.format]
  )

  const handleChapterChange = useCallback((chapterId: string) => {
    setCurrentChapterId(chapterId)
  }, [])
  // Notes sidebar shows only the current chapter's highlights.
  const chapterHighlights = highlights.filter((h) => h.chapterId === activeChapterId)
  const wpIndexMap = buildWeakPointIndexMap(chapterHighlights)
  const displayedHighlights = sortHighlightsForDisplay(
    chapterHighlights.filter((h) => highlightFilter === 'all' || h.source === highlightFilter),
    wpIndexMap
  )

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
      {(tocOpen || notesOpen) && isMobile && (
        <div
          className="absolute inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => {
            setTocOpen(false)
            setNotesOpen(false)
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
          style={isMobile ? { paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' } : undefined}
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
            <button
              onClick={() => setNotesOpen(!notesOpen)}
              className="rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              title={notesOpen ? '隐藏笔记' : '显示笔记'}
            >
              {notesOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
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
              onImageSelect={handleImageSelect}
              onHighlightsChange={refreshHighlights}
              onUnlocatedChange={setUnlocatedIds}
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
              onClose={() => setSelection(null)}
              onSaved={refreshHighlights}
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

      {notesOpen && (
        <aside className="absolute inset-y-0 right-0 z-30 w-72 max-w-[85vw] shrink-0 overflow-y-auto border-l border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900 md:relative md:z-auto md:max-w-none md:shadow-none">
          <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Highlighter className="h-4 w-4 text-yellow-500" />
              划线笔记 ({chapterHighlights.length})
            </div>
            <div className="mt-2 flex gap-1">
              {([
                { key: 'all' as const, label: '全部' },
                { key: 'user' as const, label: '我的划线' },
                { key: 'quiz' as const, label: '薄弱点' },
              ]).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setHighlightFilter(f.key)}
                  className={`rounded px-2 py-0.5 text-xs ${
                    highlightFilter === f.key
                      ? 'bg-specula-100 text-specula-700 dark:bg-specula-900/30 dark:text-specula-400'
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 p-3">
            {displayedHighlights.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-500">
                {highlightFilter === 'quiz' ? '本章暂无薄弱点标记' : '选中文字即可 AI 解释并保存划线'}
              </p>
            ) : (
              displayedHighlights.map((h) => {
                const wpIndex = getWeakPointIndex(h, wpIndexMap)
                const wpStyle = wpIndex ? getWeakPointSidebarStyle(wpIndex) : null
                return (
                <div
                  key={h.id}
                  className={`card p-3 ${h.source === 'quiz' && wpStyle ? `border-l-2 ${wpStyle.border}` : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {h.source === 'quiz' && wpIndex && wpStyle ? (
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${wpStyle.badge}`}
                        title={`薄弱点 #${wpIndex}`}
                      >
                        {wpIndex}
                      </span>
                    ) : h.source === 'quiz' ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
                    ) : null}
                    <blockquote className={`flex-1 border-l-2 pl-2 text-xs italic ${
                      h.source === 'quiz' && wpStyle
                        ? wpStyle.quote
                        : 'border-l-yellow-400'
                    }`}>
                      {h.selectedText.slice(0, 100)}
                      {h.selectedText.length > 100 ? '...' : ''}
                    </blockquote>
                  </div>
                  {h.source === 'quiz' && h.weakPointTopic && (
                    <div className={`mt-1 text-xs font-medium ${wpStyle?.topic ?? 'text-orange-600 dark:text-orange-400'}`}>
                      {wpIndex ? `#${wpIndex} ` : ''}{h.weakPointTopic}
                    </div>
                  )}
                  {book.format === 'epub' && unlocatedIds.includes(h.id) && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
                      <AlertTriangle className="h-3 w-3" />
                      未能在正文定位（仅在此显示）
                    </div>
                  )}
                  {h.aiExplanation && (
                    <p className="mt-2 line-clamp-4 text-xs text-gray-600 dark:text-gray-400">
                      {h.aiExplanation}
                    </p>
                  )}
                  <button
                    onClick={async () => {
                      await window.specula.highlights.delete(h.id)
                      refreshHighlights()
                    }}
                    className="mt-2 text-xs text-red-500 hover:underline"
                  >
                    删除
                  </button>
                </div>
              )})
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
