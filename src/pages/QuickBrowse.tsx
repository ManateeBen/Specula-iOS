import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, RotateCcw, Sparkles } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Book, ChapterDigest, QuickBrowseProgress } from '../types'

function highlightTerms(summary: string, terms: string[]) {
  const usable = terms.filter((term) => term && summary.includes(term)).sort((a, b) => b.length - a.length)
  if (usable.length === 0) return summary
  const escaped = usable.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = summary.split(new RegExp(`(${escaped.join('|')})`, 'g'))
  return parts.map((part, index) =>
    usable.includes(part) ? <strong key={`${part}-${index}`} className="font-semibold text-specula-600 dark:text-specula-300">{part}</strong> : part
  )
}

export default function QuickBrowse() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
  const navigate = useNavigate()
  const railRef = useRef<HTMLDivElement>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [progress, setProgress] = useState<QuickBrowseProgress | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const initialSummaryRestore = useRef(false)

  const load = useCallback(async () => {
    if (!bookId || !chapterId) return
    setLoading(true)
    setError('')
    const [nextBook, saved] = await Promise.all([
      window.specula.books.get(bookId),
      window.specula.quickBrowse.getProgress(bookId),
    ])
    setBook(nextBook)
    setProgress(saved)
    if (!saved.digests.some((item) => item.chapterId === chapterId)) {
      try {
        setProgress(await window.specula.quickBrowse.prepare(bookId, chapterId))
      } catch (err) {
        setError(err instanceof Error ? err.message : '快速浏览卡片生成失败')
      } finally {
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [bookId, chapterId])

  useEffect(() => {
    void load()
    if (bookId) void window.specula.quickBrowse.track(bookId, 'quick_browse_opened')
  }, [bookId, load])

  const digests = (progress?.digests || []).filter((item) => item.chapterId === chapterId)
  const gaps = useMemo(() => digests.filter((item) => item.status === 'gap'), [digests])
  const answeredCount = digests.filter((item) => item.status !== 'unanswered').length
  const allAnswered = digests.length > 0 && answeredCount === digests.length
  const totalCards = digests.length + 1

  const scrollToCard = (index: number) => {
    const rail = railRef.current
    const target = rail?.children.item(index) as HTMLElement | null
    target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  useEffect(() => {
    if (!allAnswered || initialSummaryRestore.current) return
    initialSummaryRestore.current = true
    requestAnimationFrame(() => scrollToCard(totalCards - 1))
  }, [allAnswered, totalCards])

  const answer = async (digest: ChapterDigest, status: 'confident' | 'gap', index: number) => {
    if (!bookId || digest.status !== 'unanswered') return
    const updated = await window.specula.quickBrowse.answer(bookId, digest.id, status)
    setProgress((current) => current ? {
      ...current,
      digests: current.digests.map((item) => item.id === updated.id ? updated : item),
    } : current)
    window.setTimeout(() => scrollToCard(Math.min(index + 1, totalCards - 1)), 400)
  }

  const reset = async () => {
    if (!bookId || !chapterId) return
    await window.specula.quickBrowse.reset(bookId, chapterId)
    setProgress((current) => current ? {
      ...current,
      digests: current.digests.map((item) => item.chapterId === chapterId
        ? { ...item, status: 'unanswered', answeredAt: null }
        : item),
    } : current)
    setActiveIndex(0)
    scrollToCard(0)
  }

  const openGap = async (digest: ChapterDigest) => {
    if (!bookId) return
    await window.specula.quickBrowse.track(bookId, 'quick_browse_gap_opened', digest.chapterId)
    navigate(`/reader/${bookId}?chapterId=${encodeURIComponent(digest.chapterId)}&gapId=${encodeURIComponent(digest.id)}`)
  }

  const handleScroll = () => {
    const rail = railRef.current
    if (!rail || rail.clientWidth === 0) return
    const center = rail.scrollLeft + rail.clientWidth / 2
    let nearest = 0
    let distance = Number.POSITIVE_INFINITY
    Array.from(rail.children).forEach((child, index) => {
      const element = child as HTMLElement
      const nextDistance = Math.abs(element.offsetLeft + element.offsetWidth / 2 - center)
      if (nextDistance < distance) {
        nearest = index
        distance = nextDistance
      }
    })
    if (nearest !== activeIndex) {
      setActiveIndex(nearest)
      if (nearest === totalCards - 1 && bookId) {
        void window.specula.quickBrowse.track(bookId, 'quick_browse_reached_summary', undefined, { answeredCount, total: digests.length })
      }
    }
  }

  return (
    <div role="main" className="flex h-full flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" aria-label="quick-browse-page">
      <header className="safe-top flex shrink-0 items-center justify-between border-b border-gray-200 bg-white/95 px-3 pb-2 pt-2 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={`/reader/${bookId}?chapterId=${encodeURIComponent(chapterId || '')}`} aria-label="quick-browse-back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{book?.title || '快速浏览'}</h1>
            <p className="text-xs text-specula-600 dark:text-specula-300">快速浏览本章</p>
          </div>
        </div>
        {digests.some((item) => item.status !== 'unanswered') && (
          <button onClick={reset} className="flex min-h-11 items-center gap-1.5 px-2 text-xs text-gray-500" aria-label="重新浏览">
            <RotateCcw className="h-4 w-4" />
            重新浏览
          </button>
        )}
      </header>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <Sparkles className="h-7 w-7 animate-pulse text-specula-500" />
          <div>
            <p className="font-medium">正在折叠本章的山河</p>
            <p className="mt-2 text-sm leading-6 text-gray-500">首次进入会生成本章浓缩卡片，之后可直接恢复。</p>
          </div>
        </div>
      ) : error || digests.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="font-medium">本章暂时没有可用卡片</p>
          <p className="text-sm leading-6 text-gray-500">{error || '章节内容未通过摘要与锚点校验，正常阅读不受影响。'}</p>
          <button className="btn-primary mt-2" onClick={() => void load()}>再试一次</button>
        </div>
      ) : (
        <>
          <div
            ref={railRef}
            onScroll={handleScroll}
            className="flex min-h-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden px-[7vw] py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {digests.map((digest, index) => {
              const answered = digest.status !== 'unanswered'
              const isGap = digest.status === 'gap'
              return (
                <article
                  key={digest.id}
                  className={`relative flex h-full min-w-[86vw] snap-center flex-col overflow-y-auto rounded-lg border bg-white px-5 py-5 shadow-sm transition dark:bg-gray-900 sm:min-w-[min(520px,86vw)] ${
                    isGap ? 'border-red-400 dark:border-red-700' : answered ? 'border-emerald-300 opacity-75 dark:border-emerald-800' : 'border-gray-200 dark:border-gray-700'
                  }`}
                  aria-label={`quick-browse-card-${index + 1}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs font-semibold uppercase text-specula-600 dark:text-specula-300">
                      {String(index + 1).padStart(2, '0')} · {digest.chapterTitle}
                    </span>
                    {answered && (
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${isGap ? 'bg-red-100 text-red-700 dark:bg-red-950' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950'}`}>
                        {isGap ? '○' : <Check className="h-4 w-4" />}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-5 text-xl font-semibold leading-8">{digest.title}</h2>
                  <p className="mt-4 text-[15px] leading-8 text-gray-700 dark:text-gray-200">
                    {highlightTerms(digest.summary, digest.keyTerms)}
                  </p>
                  <div className="my-6 border-t border-dashed border-gray-300 dark:border-gray-600" />
                  <p className="text-xs font-semibold text-gray-500">机制拷问</p>
                  <p className="mt-3 text-base font-semibold leading-7">{digest.question}</p>
                  <div className="mt-auto pt-7">
                    {answered ? (
                      <p className="py-3 text-center text-sm text-gray-500">已记录，继续滑动</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => void answer(digest, 'confident', index)} className="min-h-12 rounded-lg border border-specula-400 px-3 text-sm font-medium text-specula-700 dark:text-specula-300">我能答上来</button>
                        <button onClick={() => void answer(digest, 'gap', index)} className="min-h-12 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white active:bg-red-700">答不上来</button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}

            <article className="flex h-full min-w-[86vw] snap-center flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white px-5 py-6 shadow-sm dark:border-gray-700 dark:bg-gray-900 sm:min-w-[min(520px,86vw)]" aria-label="quick-browse-summary">
              {gaps.length > 0 ? (
                <>
                  <p className="text-xs font-semibold text-red-600">浏览结算 · 已回答 {answeredCount}/{digests.length}</p>
                  <h2 className="mt-3 text-2xl font-semibold">发现 {gaps.length} 个认知缺口</h2>
                  <p className="mt-2 text-sm text-gray-500">卡片彼此独立，可以随时回来继续；先从最想弄懂的缺口开始。</p>
                  <div className="mt-6 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                    {gaps.map((gap) => (
                      <button key={gap.id} onClick={() => void openGap(gap)} aria-label={`quick-browse-gap-${gap.cardIndex + 1}`} className="flex w-full items-center gap-3 py-4 text-left">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-6">{gap.question}</p>
                          <p className="mt-1 text-xs text-gray-500">直达答案所在段落 · 卡片 {gap.cardIndex + 1}</p>
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-red-500" />
                      </button>
                    ))}
                  </div>
                </>
              ) : !allAnswered ? (
                <div className="m-auto text-center">
                  <Sparkles className="mx-auto h-7 w-7 text-specula-500" />
                  <h2 className="mt-4 text-xl font-semibold">本章浏览进度 {answeredCount}/{digests.length}</h2>
                  <p className="mt-3 text-sm leading-6 text-gray-500">每张卡片都独立显示，可以自由滑动、按任意顺序回答。</p>
                </div>
              ) : (
                <div className="m-auto text-center">
                  <Check className="mx-auto h-8 w-8 text-emerald-500" />
                  <h2 className="mt-4 text-2xl font-semibold">全部有把握？</h2>
                  <p className="mt-3 text-sm leading-6 text-gray-500">很好。回到正文挑一个最想验证的章节，让理解再落深一层。</p>
                  <Link to={`/reader/${bookId}`} className="btn-primary mt-6">回到正文</Link>
                </div>
              )}
            </article>
          </div>

          <div className="shrink-0 px-5 pb-[calc(max(env(safe-area-inset-bottom),16px)+12px)] pt-1">
            <div className="flex justify-center gap-2" aria-label="quick-browse-progress">
              {Array.from({ length: totalCards }, (_, index) => {
                const digest = digests[index]
                const color = digest?.status === 'gap' ? 'bg-red-500' : digest && digest.status !== 'unanswered' ? 'bg-emerald-500' : index === activeIndex ? 'bg-specula-500' : 'bg-gray-300 dark:bg-gray-700'
                return <button key={index} onClick={() => scrollToCard(index)} aria-label={`第 ${index + 1} 张`} className={`h-2.5 w-2.5 rounded-full transition ${color} ${index === activeIndex ? 'scale-125' : ''}`} />
              })}
            </div>
            <p className="mt-3 text-center text-xs text-gray-500">左右滑动浏览卡片 · 红点 = 待修复的缺口</p>
          </div>
        </>
      )}
    </div>
  )
}
