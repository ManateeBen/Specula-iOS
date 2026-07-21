import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Book, ChapterDigest, QuickBrowseProgress } from '../types'

function highlightTerms(summary: string, terms: string[]) {
  const usable = terms.filter((term) => term && summary.includes(term)).sort((a, b) => b.length - a.length)
  if (usable.length === 0) return summary
  const escaped = usable.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = summary.split(new RegExp(`(${escaped.join('|')})`, 'g'))
  return parts.map((part, index) => usable.includes(part) ? <strong key={`${part}-${index}`}>{part}</strong> : part)
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
    try {
      // prepare is cheap for current cards and transparently regenerates cards
      // created by an older grounding contract.
      setProgress(await window.specula.quickBrowse.prepare(bookId, chapterId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '本章小样生成失败')
    } finally {
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
  const chapterNumber = (digests[0]?.chapterOrder ?? 0) + 1
  const chapterTitle = digests[0]?.chapterTitle || '本章'

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
    initialSummaryRestore.current = true
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
    <div role="main" className="records-preview" aria-label="quick-browse-page">
      <header className="preview-topbar safe-top">
        <div className="preview-topbar__identity">
          <Link to={`/reader/${bookId}?chapterId=${encodeURIComponent(chapterId || '')}`} aria-label="quick-browse-back">
            <ArrowLeft />
          </Link>
          <div>
            <h1>{book?.title || 'SPECULA RECORDS'}</h1>
            <p>PREVIEW · {loading ? 'NOW PRESSING' : `TRACK ${String(chapterNumber).padStart(2, '0')}`}</p>
          </div>
        </div>
        {digests.some((item) => item.status !== 'unanswered') && (
          <button onClick={reset} className="preview-reset" aria-label="quick-browse-reset">
            <RotateCcw />
            重新试听
          </button>
        )}
      </header>

      {loading ? (
        <main className="preview-pressing" aria-label="preview-loading">
          <div className="preview-vinyl" aria-hidden="true">
            <i className="preview-vinyl__grooves" />
            <i className="preview-vinyl__cut" />
            <span>SPC<br />PREVIEW</span>
          </div>
          <p className="preview-kicker">NOW PRESSING</p>
          <h2>正在为本章压一张<br />3 分钟小样</h2>
          <p className="preview-pressing__copy">先浓缩核心知识，再留下一道追问。<br />首次制作需要一会儿，之后即点即放。</p>
          <div className="preview-cutting" role="status">
            <span>CUTTING</span>
            <i><b /><b /><b /><b /><b /><b /><b /></i>
            <span>IN PROGRESS</span>
          </div>
        </main>
      ) : error || digests.length === 0 ? (
        <main className="preview-empty">
          <p className="preview-kicker">PRESSING PAUSED</p>
          <h2>本章暂时没有可用小样</h2>
          <p>{error || '核心知识卡片未通过内容或原文锚点校验，正常阅读不受影响。'}</p>
          <button onClick={() => void load()} aria-label="quick-browse-retry">再压一次</button>
        </main>
      ) : (
        <>
          <div ref={railRef} onScroll={handleScroll} className="preview-rail">
            {digests.map((digest, index) => {
              const answered = digest.status !== 'unanswered'
              const isGap = digest.status === 'gap'
              return (
                <article
                  key={digest.id}
                  className={`preview-card ${isGap ? 'is-open' : answered ? 'is-ok' : ''}`}
                  aria-label={`quick-browse-card-${index + 1}`}
                >
                  <div className="preview-card__topline">
                    <span>SIDE A{index + 1}</span>
                    <small>TRACK {String(chapterNumber).padStart(2, '0')} · {chapterTitle}</small>
                    {answered && <b className="preview-card__stamp">{isGap ? 'OPEN' : 'OK'}</b>}
                  </div>
                  <h2>{digest.title}</h2>
                  <p className="preview-card__summary">{highlightTerms(digest.summary, digest.keyTerms)}</p>
                  <div className="preview-question">
                    <span>ONE QUESTION</span>
                    <p>{digest.question}</p>
                  </div>
                  <div className="preview-card__actions">
                    {answered ? (
                      <p>RECORDED · 继续滑 →</p>
                    ) : (
                      <div>
                        <button onClick={() => void answer(digest, 'confident', index)} aria-label={`quick-browse-answer-confident-${index + 1}`}>我能答上来</button>
                        <button onClick={() => void answer(digest, 'gap', index)} aria-label={`quick-browse-answer-gap-${index + 1}`}>答不上来</button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}

            <article className="preview-card preview-summary" aria-label="quick-browse-summary">
              <div className="preview-card__topline">
                <span>B-SIDE</span>
                <small>PREVIEW COMPLETE · {answeredCount}/{digests.length}</small>
              </div>
              {gaps.length > 0 ? (
                <>
                  <p className="preview-kicker">OPEN QUESTIONS</p>
                  <h2>{gaps.length} 个待答问题</h2>
                  <p className="preview-summary__copy">去正文找到答案。读懂之后，把它从 OPEN 翻成 OK。</p>
                  <div className="preview-gap-list">
                    {gaps.map((gap) => (
                      <button key={gap.id} onClick={() => void openGap(gap)} aria-label={`quick-browse-gap-${gap.cardIndex + 1}`}>
                        <span>{gap.question}</span>
                        <small>GO TO ANSWER <ChevronRight /></small>
                      </button>
                    ))}
                  </div>
                </>
              ) : !allAnswered ? (
                <div className="preview-summary__center">
                  <p className="preview-kicker">KEEP LISTENING</p>
                  <h2>本章试听进度<br />{answeredCount}/{digests.length}</h2>
                  <p>每张小样都独立显示，可以自由滑动，按任意顺序回答。</p>
                </div>
              ) : (
                <div className="preview-summary__center">
                  <p className="preview-kicker">ALL RECORDED</p>
                  <h2>全部有把握？</h2>
                  <p>回到正文挑一个最想验证的部分，让理解再落深一层。</p>
                  <Link to={`/reader/${bookId}`}>回到正文</Link>
                </div>
              )}
            </article>
          </div>

          <footer className="preview-footer">
            <div aria-label="quick-browse-progress">
              {Array.from({ length: totalCards }, (_, index) => {
                const digest = digests[index]
                const state = digest?.status === 'gap' ? 'is-open' : digest && digest.status !== 'unanswered' ? 'is-ok' : ''
                return <button key={index} onClick={() => scrollToCard(index)} aria-label={`第 ${index + 1} 张`} className={`${state} ${index === activeIndex ? 'is-current' : ''}`} />
              })}
            </div>
            <p>SWIPE · 蓝格 = OPEN QUESTION</p>
          </footer>
        </>
      )}
    </div>
  )
}
