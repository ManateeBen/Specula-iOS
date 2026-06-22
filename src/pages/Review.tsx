import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, RefreshCw, BookOpen, AlertTriangle, BookmarkPlus, Loader2, Clock, History } from 'lucide-react'
import type { Book, QuizAttempt, WeakPoint } from '../types'

const categoryLabels = {
  concept_confusion: '概念混淆',
  missing_detail: '遗漏细节',
  misunderstanding: '理解偏差',
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function Review() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
  const [book, setBook] = useState<Book | null>(null)
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null)
  const [history, setHistory] = useState<QuizAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [markingWeakPoints, setMarkingWeakPoints] = useState(false)
  const [weakPointsMarked, setWeakPointsMarked] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [markError, setMarkError] = useState('')

  useEffect(() => {
    if (!bookId || !chapterId) return
    const load = async () => {
      const b = await window.specula.books.get(bookId)
      setBook(b)

      // Load all attempts for this chapter
      const allAttempts = await window.specula.quiz.getHistoryByChapter(chapterId)
      setHistory(allAttempts)

      // Show the latest attempt
      if (allAttempts.length > 0) {
        setAttempt(allAttempts[0])
      }

      setLoading(false)
    }
    load()
  }, [bookId, chapterId])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-500">加载中...</div>
  }

  if (!attempt) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-gray-500">暂无测验记录</p>
        <Link to={`/quiz/${bookId}/${chapterId}`} className="btn-primary">
          开始测验
        </Link>
      </div>
    )
  }

  const weakPoints: WeakPoint[] = attempt.weakPoints

  const handleMarkWeakPoints = async () => {
    if (!bookId || !chapterId || weakPoints.length === 0) return
    setMarkingWeakPoints(true)
    setMarkError('')
    try {
      await window.specula.highlights.createFromWeakPoints({
        bookId,
        chapterId,
        weakPoints,
      })
      setWeakPointsMarked(true)
    } catch (err) {
      setMarkError(err instanceof Error ? err.message : '标记薄弱点失败')
    }
    setMarkingWeakPoints(false)
  }

  // Score trend (last 5 attempts, oldest first)
  const trendAttempts = [...history].reverse().slice(-5)
  const maxScore = 100

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Link
            to={`/reader/${bookId}`}
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold">学习诊断</h1>
            <p className="text-sm text-gray-500">{book?.title}</p>
          </div>
          <Link
            to={`/quiz/${bookId}/${chapterId}`}
            className="btn-primary py-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            新测验
          </Link>
        </div>

        {/* Score card */}
        <div className="card mb-6 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold text-specula-600">{attempt.score}</div>
              <div className="text-sm text-gray-500">本次得分</div>
              <div className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                <Clock className="h-3 w-3" />
                用时 {formatTime(attempt.timeTakenMs)}
                <span className="mx-1">·</span>
                {formatDate(attempt.completedAt)}
              </div>
            </div>
            {weakPoints.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600">
                <BookOpen className="h-5 w-5" />
                <span className="text-sm font-medium">全部掌握！</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-sm font-medium">{weakPoints.length} 个薄弱点</span>
              </div>
            )}
          </div>

          {/* Score trend bar */}
          {history.length > 1 && (
            <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>分数趋势</span>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="text-specula-600 hover:underline"
                >
                  {showHistory ? '收起' : `查看全部 (${history.length})`}
                </button>
              </div>
              <div className="flex items-end gap-1.5">
                {trendAttempts.map((a, i) => (
                  <div key={a.id} className="flex flex-1 flex-col items-center">
                    <div
                      className={`w-full rounded-t ${
                        a.id === attempt.id
                          ? 'bg-specula-500'
                          : 'bg-specula-200 dark:bg-specula-800'
                      }`}
                      style={{ height: `${Math.max((a.score / maxScore) * 48, 4)}px` }}
                      title={`得分: ${a.score}`}
                    />
                    <span className="mt-1 text-[10px] text-gray-400">
                      {a.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* History list */}
        {showHistory && history.length > 1 && (
          <div className="card mb-6 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" />
              测验历史
            </h3>
            <div className="space-y-2">
              {history.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setAttempt(a)
                    setWeakPointsMarked(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    a.id === attempt.id
                      ? 'bg-specula-50 dark:bg-specula-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">#{history.length - i}</span>
                    <span className="font-medium">{a.score} 分</span>
                    <span className="text-xs text-gray-400">{formatDate(a.completedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Clock className="h-3 w-3" />
                    {formatTime(a.timeTakenMs)}
                    {a.weakPoints.length > 0 && (
                      <span className="text-orange-500">{a.weakPoints.length} 薄弱</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Weak points */}
        {weakPoints.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400">
              恭喜！你已经很好地理解了本章内容。可以尝试下一章或重新测验巩固。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-gray-500">薄弱知识点分析</h2>
            {weakPoints.map((wp, i) => (
              <div key={i} className="card p-5">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                      {categoryLabels[wp.category]}
                    </span>
                    <h3 className="font-medium">{wp.topic}</h3>
                  </div>
                  <Link
                    to={`/reader/${bookId}?chapterId=${chapterId}&highlight=${encodeURIComponent(wp.sourceExcerpt)}`}
                    className="shrink-0 rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50"
                  >
                    去原文查看
                  </Link>
                </div>
                <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{wp.reason}</p>
                <div className="rounded-lg bg-specula-50 p-4 dark:bg-specula-900/20">
                  <div className="mb-1 text-xs font-medium text-specula-700 dark:text-specula-400">
                    针对性教学
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{wp.miniLesson}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {markError && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{markError}</p>
        )}

        <div className="mt-6 flex gap-3">
          {weakPointsMarked ? (
            <Link to={`/reader/${bookId}`} className="btn-primary flex-1">
              <BookOpen className="h-4 w-4" />
              去原文查看标记
            </Link>
          ) : weakPoints.length > 0 ? (
            <button
              onClick={handleMarkWeakPoints}
              disabled={markingWeakPoints}
              className="btn-primary flex-1"
            >
              {markingWeakPoints ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
              标记薄弱点到原文
            </button>
          ) : null}
          <Link to={`/reader/${bookId}`} className="btn-secondary flex-1">
            <BookOpen className="h-4 w-4" />
            继续阅读
          </Link>
          <Link
            to={`/quiz/${bookId}/${chapterId}`}
            className="btn-secondary flex-1"
          >
            <RefreshCw className="h-4 w-4" />
            重新测验
          </Link>
        </div>
      </div>
    </div>
  )
}
