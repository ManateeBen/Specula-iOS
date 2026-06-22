import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, CheckCircle, XCircle, BookmarkPlus, Clock, History } from 'lucide-react'
import QuizSetupForm, { type QuizConfig, clampQuizCount } from '../components/QuizSetupForm'
import type {
  Book,
  Chapter,
  Quiz,
  QuizQuestion,
  QuizAnswer,
  WeakPoint,
} from '../types'
import { QUESTION_TYPE_LABELS } from '../types'

type Phase = 'init' | 'setup' | 'loading' | 'quiz' | 'grading' | 'result'

const DEFAULT_CONFIG: QuizConfig = { questionCount: 5, quizPreset: 'all' }

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function isQuestionAnswered(q: QuizQuestion, answers: Record<string, string>): boolean {
  const a = answers[q.id]
  if (q.type === 'multi_choice') return !!a && a.split('|').filter(Boolean).length > 0
  return !!a?.trim()
}

export default function QuizPage() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
  const [book, setBook] = useState<Book | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [existingQuiz, setExistingQuiz] = useState<Quiz | null>(null)
  const [quizConfig, setQuizConfig] = useState<QuizConfig>(DEFAULT_CONFIG)
  const [phase, setPhase] = useState<Phase>('init')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [score, setScore] = useState(0)
  const [results, setResults] = useState<{ questionId: string; correct: boolean; feedback: string }[]>([])
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([])
  const [markingWeakPoints, setMarkingWeakPoints] = useState(false)
  const [weakPointsMarked, setWeakPointsMarked] = useState(false)
  const [error, setError] = useState('')

  const startTimeRef = useRef<number>(0)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = () => {
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current)
    }, 1000)
  }

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return Date.now() - startTimeRef.current
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!bookId || !chapterId) return
    const init = async () => {
      setPhase('init')
      setError('')
      try {
        const b = await window.specula.books.get(bookId)
        setBook(b)
        const chapters = await window.specula.chapters.listByBook(bookId)
        const ch = chapters.find((c) => c.id === chapterId) || null
        setChapter(ch)

        const existing = await window.specula.quiz.getByChapter(chapterId)
        if (existing && existing.questions.length > 0) {
          setExistingQuiz(existing)
        } else {
          setExistingQuiz(null)
        }
        setPhase('setup')
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
        setPhase('setup')
      }
    }
    init()
  }, [bookId, chapterId])

  const generateQuiz = async (config: QuizConfig, avoidQuestions?: string[]) => {
    if (!chapterId) return
    setError('')
    setPhase('loading')

    try {
      const content = await window.specula.chapters.getContent(chapterId)
      if (!content.trim()) {
        setError('无法提取章节内容，请确保书籍格式正确')
        setPhase('setup')
        return
      }

      const q = await window.specula.ai.generateQuiz({
        chapterId,
        chapterTitle: chapter?.title || '章节',
        chapterContent: content,
        questionCount: clampQuizCount(config.questionCount),
        quizPreset: config.quizPreset,
        avoidQuestions,
      })

      setQuiz(q)
      setExistingQuiz(q)
      setQuizConfig(config)
      setAnswers({})
      setResults([])
      setScore(0)
      setWeakPoints([])
      setWeakPointsMarked(false)
      setElapsed(0)
      setPhase('quiz')
      startTimer()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成测验失败')
      setPhase('setup')
    }
  }

  const handleStartGenerate = () => {
    const avoid = existingQuiz?.questions.map((q) => q.question)
    generateQuiz(quizConfig, avoid && avoid.length > 0 ? avoid : undefined)
  }

  const handleContinueExisting = () => {
    if (!existingQuiz) return
    setError('')
    setQuiz(existingQuiz)
    setAnswers({})
    setResults([])
    setScore(0)
    setWeakPoints([])
    setWeakPointsMarked(false)
    setElapsed(0)
    setPhase('quiz')
    startTimer()
  }

  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  const handleMultiChoiceChange = (questionId: string, opt: string, checked: boolean) => {
    const current = answers[questionId]?.split('|').filter(Boolean) || []
    const next = checked ? [...current, opt] : current.filter((o) => o !== opt)
    handleAnswerChange(questionId, next.join('|'))
  }

  const handleSubmit = async () => {
    if (!quiz || !chapterId) return
    setPhase('grading')
    const timeTakenMs = stopTimer()

    const answerList: QuizAnswer[] = quiz.questions.map((q) => ({
      questionId: q.id,
      answer: answers[q.id] || '',
    }))

    try {
      const gradeResult = await window.specula.ai.gradeQuiz({
        questions: quiz.questions,
        answers: answerList,
      })
      setScore(gradeResult.score)
      setResults(gradeResult.results)

      const settings = await window.specula.settings.get()
      const chapterContent = await window.specula.chapters.getContent(chapterId)
      const wp = await window.specula.ai.analyzeWeakPoints({
        chapterId,
        chapterContent,
        questions: quiz.questions,
        answers: answerList,
        results: gradeResult.results,
        teachingMode: settings.defaultTeachingMode,
      })

      setWeakPoints(wp)

      await window.specula.quiz.saveAttempt({
        quizId: quiz.id,
        answers: answerList,
        score: gradeResult.score,
        weakPoints: wp,
        results: gradeResult.results,
        timeTakenMs,
      })

      setPhase('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : '评分失败')
      setPhase('quiz')
    }
  }

  const handleMarkWeakPoints = async () => {
    if (!bookId || !chapterId || weakPoints.length === 0) return
    setMarkingWeakPoints(true)
    try {
      await window.specula.highlights.createFromWeakPoints({
        bookId,
        chapterId,
        weakPoints,
      })
      setWeakPointsMarked(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '标记薄弱点失败')
    }
    setMarkingWeakPoints(false)
  }

  const handleRegenerate = () => {
    setAnswers({})
    setResults([])
    setScore(0)
    setWeakPoints([])
    setWeakPointsMarked(false)
    setQuiz(null)
    setError('')
    setElapsed(0)
    stopTimer()
    setPhase('setup')
  }

  const renderQuestion = (q: QuizQuestion, index: number) => {
    const result = results.find((r) => r.questionId === q.id)
    const selectedMulti = (answers[q.id] || '').split('|').filter(Boolean)

    return (
      <div key={q.id} className="card p-4">
        <div className="mb-3 flex items-start gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-specula-100 text-xs font-medium text-specula-700 dark:bg-specula-900/30 dark:text-specula-400">
            {index + 1}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">{q.question}</p>
            <span className="mt-1 inline-block text-xs text-gray-500">
              {QUESTION_TYPE_LABELS[q.type] || q.type}
            </span>
          </div>
          {result &&
            (result.correct ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            ))}
        </div>

        {q.type === 'choice' && q.options && (
          <div className="ml-8 space-y-2">
            {q.options.map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={q.id}
                  value={opt}
                  checked={answers[q.id] === opt}
                  onChange={() => handleAnswerChange(q.id, opt)}
                  disabled={phase === 'result'}
                  className="text-specula-600"
                />
                {opt}
              </label>
            ))}
          </div>
        )}

        {q.type === 'multi_choice' && q.options && (
          <div className="ml-8 space-y-2">
            {q.options.map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedMulti.includes(opt)}
                  onChange={(e) => handleMultiChoiceChange(q.id, opt, e.target.checked)}
                  disabled={phase === 'result'}
                  className="text-specula-600"
                />
                {opt}
              </label>
            ))}
          </div>
        )}

        {q.type === 'fill' && (
          <input
            type="text"
            value={answers[q.id] || ''}
            onChange={(e) => handleAnswerChange(q.id, e.target.value)}
            disabled={phase === 'result'}
            className="input ml-8"
            placeholder="请输入答案"
          />
        )}

        {q.type === 'short' && (
          <textarea
            value={answers[q.id] || ''}
            onChange={(e) => handleAnswerChange(q.id, e.target.value)}
            disabled={phase === 'result'}
            className="input ml-8 min-h-[80px] resize-y"
            placeholder="请输入你的回答"
          />
        )}

        {result && !result.correct && (
          <p className="ml-8 mt-2 text-xs text-red-600 dark:text-red-400">{result.feedback}</p>
        )}
      </div>
    )
  }

  const correctCount = results.filter((r) => r.correct).length
  const totalCount = results.length
  const allAnswered = quiz ? quiz.questions.every((q) => isQuestionAnswered(q, answers)) : false

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
            <h1 className="text-lg font-bold">章节测验</h1>
            <p className="text-sm text-gray-500">
              {book?.title} · {chapter?.title}
            </p>
          </div>
          <Link
            to={`/quiz-history/${bookId}/${chapterId}`}
            className="btn-secondary py-1.5 text-xs"
          >
            <History className="h-3.5 w-3.5" />
            历史记录
          </Link>
        </div>

        {phase === 'init' && (
          <div className="flex flex-col items-center py-20">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-specula-500" />
            <p className="text-sm text-gray-500">加载中...</p>
          </div>
        )}

        {phase === 'setup' && (
          <QuizSetupForm
            config={quizConfig}
            onChange={setQuizConfig}
            existingQuestionCount={existingQuiz?.questions.length}
            onStart={handleStartGenerate}
            onContinue={existingQuiz ? handleContinueExisting : undefined}
            starting={false}
          />
        )}

        {phase === 'loading' && (
          <div className="flex flex-col items-center py-20">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-specula-500" />
            <p className="text-sm text-gray-500">
              AI 正在生成 {quizConfig.questionCount} 道测验题...
            </p>
          </div>
        )}

        {error && (
          <div className="card mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {(phase === 'quiz' || phase === 'grading') && quiz && (
          <>
            <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
              <Clock className="h-4 w-4" />
              {formatTime(elapsed)}
              <span className="mx-2">·</span>
              {quiz.questions.length} 题
            </div>
            <div className="space-y-4">
              {quiz.questions.map((q, i) => renderQuestion(q, i))}
            </div>
            {phase === 'quiz' && (
              <div className="mt-6 flex justify-end">
                <button onClick={handleSubmit} disabled={!allAnswered} className="btn-primary">
                  提交答案
                </button>
              </div>
            )}
            {phase === 'grading' && (
              <div className="mt-6 flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI 正在评分与分析...
              </div>
            )}
          </>
        )}

        {phase === 'result' && quiz && (
          <>
            <div className="card mb-6 p-6 text-center">
              <div className="text-4xl font-bold text-specula-600">{score}</div>
              <div className="mt-1 text-sm text-gray-500">
                得分 · {correctCount}/{totalCount} 正确
              </div>
              <div className="mt-1 flex items-center justify-center gap-1 text-xs text-gray-400">
                <Clock className="h-3 w-3" />
                用时 {formatTime(elapsed)}
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                {weakPoints.length > 0 && !weakPointsMarked && (
                  <button
                    onClick={handleMarkWeakPoints}
                    disabled={markingWeakPoints}
                    className="btn-primary"
                  >
                    {markingWeakPoints ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <BookmarkPlus className="h-4 w-4" />
                    )}
                    标记薄弱点到原文
                  </button>
                )}
                {weakPointsMarked && (
                  <Link to={`/reader/${bookId}`} className="btn-primary">
                    去原文查看标记
                  </Link>
                )}
                <button onClick={handleRegenerate} className="btn-secondary">
                  生成新测验
                </button>
                <Link to={`/reader/${bookId}`} className="btn-secondary">
                  返回阅读
                </Link>
              </div>
            </div>

            {weakPoints.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 text-sm font-medium text-gray-500">薄弱知识点</h2>
                <div className="space-y-3">
                  {weakPoints.map((wp, i) => (
                    <div key={i} className="card border-l-2 border-l-orange-400 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h3 className="text-sm font-medium">{wp.topic}</h3>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{wp.reason}</p>
                        </div>
                        <Link
                          to={`/reader/${bookId}?chapterId=${chapterId}&highlight=${encodeURIComponent(wp.sourceExcerpt)}`}
                          className="shrink-0 rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50"
                        >
                          去原文查看
                        </Link>
                      </div>
                      <div className="mt-2 rounded bg-specula-50 p-3 text-xs leading-relaxed dark:bg-specula-900/20">
                        {wp.miniLesson}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h2 className="text-sm font-medium text-gray-500">答题详情</h2>
              {quiz.questions.map((q, i) => renderQuestion(q, i))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
