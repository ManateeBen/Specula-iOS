import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Clock, AlertTriangle, TrendingUp, RefreshCw } from 'lucide-react'
import type { Book, Chapter, QuizAttempt } from '../types'

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function QuizHistory() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
  const [book, setBook] = useState<Book | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [history, setHistory] = useState<QuizAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!bookId || !chapterId) return
    const load = async () => {
      const b = await window.specula.books.get(bookId)
      setBook(b)
      const chapters = await window.specula.chapters.listByBook(bookId)
      setChapter(chapters.find((c) => c.id === chapterId) || null)

      const attempts = await window.specula.quiz.getHistoryByChapter(chapterId)
      setHistory(attempts)
      setLoading(false)
    }
    load()
  }, [bookId, chapterId])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-500">加载中...</div>
  }

  // Stats
  const avgScore = history.length > 0
    ? Math.round(history.reduce((sum, a) => sum + a.score, 0) / history.length)
    : 0
  const bestScore = history.length > 0 ? Math.max(...history.map((a) => a.score)) : 0
  const avgTime = history.length > 0
    ? Math.round(history.reduce((sum, a) => sum + a.timeTakenMs, 0) / history.length)
    : 0
  const totalWeakPoints = history.reduce((sum, a) => sum + a.weakPoints.length, 0)

  // Trend (oldest first for chart)
  const trend = [...history].reverse()

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
            <h1 className="text-lg font-bold">测验历史</h1>
            <p className="text-sm text-gray-500">
              {book?.title} · {chapter?.title}
            </p>
          </div>
          <Link
            to={`/quiz/${bookId}/${chapterId}`}
            className="btn-primary py-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            新测验
          </Link>
        </div>

        {history.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-gray-500">暂无测验记录</p>
            <Link to={`/quiz/${bookId}/${chapterId}`} className="btn-primary mt-4">
              开始第一次测验
            </Link>
          </div>
        ) : (
          <>
            {/* Stats overview */}
            <div className="mb-6 grid grid-cols-4 gap-3">
              <div className="card p-3 text-center">
                <div className="text-lg font-bold text-specula-600">{avgScore}</div>
                <div className="text-[10px] text-gray-500">平均分</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-lg font-bold text-green-600">{bestScore}</div>
                <div className="text-[10px] text-gray-500">最高分</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-lg font-bold text-blue-600">{formatTime(avgTime)}</div>
                <div className="text-[10px] text-gray-500">平均用时</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-lg font-bold text-orange-600">{totalWeakPoints}</div>
                <div className="text-[10px] text-gray-500">薄弱点总计</div>
              </div>
            </div>

            {/* Score trend */}
            {trend.length > 1 && (
              <div className="card mb-6 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <TrendingUp className="h-4 w-4 text-specula-500" />
                  分数趋势
                </div>
                <div className="flex items-end gap-2">
                  {trend.map((a, i) => (
                    <div key={a.id} className="flex flex-1 flex-col items-center">
                      <div
                        className="w-full rounded-t bg-specula-400 transition-all hover:bg-specula-600"
                        style={{ height: `${Math.max((a.score / 100) * 64, 4)}px` }}
                        title={`得分: ${a.score}`}
                      />
                      <span className="mt-1 text-[10px] font-medium text-gray-500">
                        {a.score}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-gray-400">
                  <span>第 1 次</span>
                  <span>第 {trend.length} 次</span>
                </div>
              </div>
            )}

            {/* History list */}
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-gray-500">
                全部记录 ({history.length})
              </h2>
              {history.map((a, i) => {
                const isExpanded = expandedId === a.id
                return (
                  <div key={a.id} className="card overflow-hidden">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          #{history.length - i}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{a.score} 分</span>
                            {a.score >= 80 ? (
                              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                优秀
                              </span>
                            ) : a.score >= 60 ? (
                              <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                                及格
                              </span>
                            ) : (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                需加强
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                            <span>{formatDate(a.completedAt)}</span>
                            <span>·</span>
                            <Clock className="h-3 w-3" />
                            <span>{formatTime(a.timeTakenMs)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {a.weakPoints.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-orange-500">
                            <AlertTriangle className="h-3 w-3" />
                            {a.weakPoints.length}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {isExpanded ? '收起' : '展开'}
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
                        {/* Results breakdown */}
                        <div className="mb-3">
                          <div className="mb-2 text-xs font-medium text-gray-500">答题情况</div>
                          <div className="flex flex-wrap gap-1.5">
                            {a.results.map((r, qi) => (
                              <span
                                key={r.questionId}
                                className={`flex h-6 w-6 items-center justify-center rounded text-[10px] font-medium ${
                                  r.correct
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                }`}
                                title={r.feedback}
                              >
                                {qi + 1}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Weak points */}
                        {a.weakPoints.length > 0 && (
                          <div>
                            <div className="mb-2 text-xs font-medium text-gray-500">薄弱点</div>
                            <div className="space-y-2">
                              {a.weakPoints.map((wp, wi) => (
                                <div key={wi} className="flex items-start gap-2">
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-orange-500" />
                                  <div className="flex-1">
                                    <div className="text-xs font-medium">{wp.topic}</div>
                                    <div className="text-[10px] text-gray-500">{wp.reason}</div>
                                  </div>
                                  <Link
                                    to={`/reader/${bookId}?chapterId=${chapterId}&highlight=${encodeURIComponent(wp.sourceExcerpt)}`}
                                    className="shrink-0 text-[10px] text-specula-600 hover:underline"
                                  >
                                    去原文
                                  </Link>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex gap-2">
                          <Link
                            to={`/review/${bookId}/${chapterId}`}
                            className="text-xs text-specula-600 hover:underline"
                          >
                            查看完整诊断
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
