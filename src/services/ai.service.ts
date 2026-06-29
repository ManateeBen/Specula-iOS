import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import { getTextConfig, getDefaultTeachingMode, getVisionConfig } from './settings.service'
import { runSql, queryOne, queryAll } from './db'
import {
  TEACHING_PROMPTS,
  GRADE_SYSTEM_PROMPT,
  WEAK_POINTS_SYSTEM_PROMPT,
  buildExplainUserMessage,
  buildImageUserMessage,
  buildQuizSystemPrompt,
  buildQuizUserMessage,
  buildWeakPointsUserMessage,
  truncateContent,
  parseJsonFromResponse,
  parseJsonArrayFromResponse,
} from './prompts'
import {
  retrieveTopChunks,
  type ChapterChunk,
  type WrongItemForRetrieval,
} from './chapterRetrieval'
import { emitExplainChunk, emitExplainDone, emitExplainError } from './streamEvents'
import type {
  ExplainRequest,
  ImageExplainRequest,
  GenerateQuizRequest,
  GradeQuizRequest,
  AnalyzeWeakPointsRequest,
  QuizQuestion,
  Quiz,
  WeakPoint,
  QuestionType,
  QuizPreset,
} from '../types'
import { TEACHING_MODE_LABELS, QUIZ_PRESET_LABELS, QUIZ_PRESET_TYPES } from '../types'

async function createClient(): Promise<OpenAI> {
  const { apiKey, baseURL } = await getTextConfig()
  if (!apiKey) throw new Error('应用未配置内置文本模型 API Key')
  if (!baseURL) throw new Error('请先在设置中配置文本模型 Base URL')
  return new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true })
}

async function getModel(): Promise<string> {
  const { model } = await getTextConfig()
  return model
}

async function createVisionClient(): Promise<{ client: OpenAI; model: string }> {
  const { apiKey, baseURL, model } = await getVisionConfig()
  if (!apiKey) throw new Error('应用未配置内置视觉模型 API Key（用于图片解释）')
  return { client: new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true }), model }
}

export async function testVision(): Promise<{ ok: boolean; message: string }> {
  try {
    const { client, model } = await createVisionClient()
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5,
    })
    return { ok: true, message: '连接成功' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '连接失败' }
  }
}

const MAX_TOKENS_EXPLAIN = 1024
const MAX_TOKENS_QUIZ = 4096
const MAX_TOKENS_GRADE = 1024
const MAX_TOKENS_WEAK_POINTS = 4096

export async function explainImageStream(req: ImageExplainRequest): Promise<void> {
  try {
    const { client, model } = await createVisionClient()
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: TEACHING_PROMPTS[req.teachingMode] },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildImageUserMessage(req) },
            { type: 'image_url', image_url: { url: req.imageDataUrl } },
          ],
        },
      ],
      temperature: 0.7,
      max_tokens: MAX_TOKENS_EXPLAIN,
      stream: true,
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) emitExplainChunk(content)
    }
    emitExplainDone()
  } catch (err) {
    const message = err instanceof Error ? err.message : '图片解释失败'
    emitExplainError(message)
    throw err
  }
}

export async function listTextModels(credentials?: {
  apiKey: string
  baseURL: string
}): Promise<{ ok: boolean; models: string[]; message?: string }> {
  const { apiKey, baseURL } = credentials || (await getTextConfig())
  if (!apiKey?.trim() || !baseURL?.trim()) {
    return { ok: false, models: [], message: '请先填写 API Key 与 Base URL' }
  }
  try {
    const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true })
    const page = await client.models.list()
    const models = [...new Set(page.data.map((m) => m.id))].sort()
    if (models.length === 0) return { ok: false, models: [], message: '接口未返回可用模型' }
    return { ok: true, models }
  } catch (err) {
    return { ok: false, models: [], message: err instanceof Error ? err.message : '获取模型列表失败' }
  }
}

export async function listVisionModels(credentials?: {
  apiKey: string
  baseURL: string
}): Promise<{ ok: boolean; models: string[]; message?: string }> {
  const { apiKey, baseURL } = credentials || (await getVisionConfig())
  if (!apiKey?.trim() || !baseURL?.trim()) {
    return { ok: false, models: [], message: '请先填写 API Key 与 Base URL' }
  }
  try {
    const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true })
    const page = await client.models.list()
    let models = [...new Set(page.data.map((m) => m.id))].sort()
    const visionLike = models.filter((id) => /vl|vision|4o|4v|glm-4v/i.test(id))
    if (visionLike.length > 0) models = visionLike
    if (models.length === 0) return { ok: false, models: [], message: '接口未返回可用模型' }
    return { ok: true, models }
  } catch (err) {
    return { ok: false, models: [], message: err instanceof Error ? err.message : '获取模型列表失败' }
  }
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const client = await createClient()
    await client.chat.completions.create({
      model: await getModel(),
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5,
    })
    return { ok: true, message: '连接成功' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '连接失败' }
  }
}

export async function explainText(req: ExplainRequest): Promise<string> {
  const client = await createClient()
  const response = await client.chat.completions.create({
    model: await getModel(),
    messages: [
      { role: 'system', content: TEACHING_PROMPTS[req.teachingMode] },
      { role: 'user', content: buildExplainUserMessage(req) },
    ],
    temperature: 0.7,
    max_tokens: MAX_TOKENS_EXPLAIN,
  })
  return response.choices[0]?.message?.content || '无法生成解释'
}

export async function explainTextStream(req: ExplainRequest): Promise<void> {
  try {
    const client = await createClient()
    const stream = await client.chat.completions.create({
      model: await getModel(),
      messages: [
        { role: 'system', content: TEACHING_PROMPTS[req.teachingMode] },
        { role: 'user', content: buildExplainUserMessage(req) },
      ],
      temperature: 0.7,
      max_tokens: MAX_TOKENS_EXPLAIN,
      stream: true,
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) emitExplainChunk(content)
    }
    emitExplainDone()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 解释失败'
    emitExplainError(message)
    throw err
  }
}

function clampQuestionCount(n: number): number {
  return Math.min(20, Math.max(1, Math.round(n) || 5))
}

function getAllowedTypes(preset: QuizPreset): QuestionType[] {
  return QUIZ_PRESET_TYPES[preset] || QUIZ_PRESET_TYPES.all
}

const VALID_QUESTION_TYPES = new Set<QuestionType>(['choice', 'multi_choice', 'fill', 'short'])

function normalizeQuestionType(raw: unknown): QuestionType | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if (t === 'choice' || t === 'single_choice' || t === '单选' || t === '单选题') return 'choice'
  if (t === 'multi_choice' || t === 'multiple_choice' || t === '多选' || t === '多选题') return 'multi_choice'
  if (t === 'fill' || t === '填空' || t === '填空题') return 'fill'
  if (t === 'short' || t === '简答' || t === '简答题') return 'short'
  if (VALID_QUESTION_TYPES.has(t as QuestionType)) return t as QuestionType
  if (t.startsWith('choice')) return 'choice'
  if (t.includes('multi')) return 'multi_choice'
  return null
}

function normalizeQuizQuestion(raw: unknown, allowedTypes: QuestionType[]): QuizQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const type = normalizeQuestionType(o.type)
  if (!type || !allowedTypes.includes(type)) return null
  const question = typeof o.question === 'string' ? o.question.trim() : ''
  const correctAnswer = typeof o.correctAnswer === 'string' ? o.correctAnswer.trim() : ''
  const explanation = typeof o.explanation === 'string' ? o.explanation.trim() : ''
  if (!question || !correctAnswer) return null

  const options = Array.isArray(o.options)
    ? o.options.filter((x): x is string => typeof x === 'string')
    : undefined

  if ((type === 'choice' || type === 'multi_choice') && (!options || options.length < 2)) return null

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : undefined
  return {
    id: id || 'q',
    type,
    question,
    options,
    correctAnswer,
    explanation: explanation || '见参考答案',
  }
}

function validateQuizQuestions(
  questions: QuizQuestion[],
  count: number,
  allowedTypes: QuestionType[]
): QuizQuestion[] {
  const allowed = new Set(allowedTypes)
  return questions.filter(
    (q) =>
      allowed.has(q.type) &&
      typeof q.question === 'string' &&
      typeof q.correctAnswer === 'string' &&
      (q.type === 'choice' || q.type === 'multi_choice' ? (q.options?.length ?? 0) >= 2 : true)
  )
}

function parseQuizQuestionsFromResponse(text: string, allowedTypes: QuestionType[]): QuizQuestion[] {
  const raw = parseJsonArrayFromResponse<unknown>(text)
  const normalized: QuizQuestion[] = []
  for (const item of raw) {
    const q = normalizeQuizQuestion(item, allowedTypes)
    if (q) normalized.push(q)
  }
  return normalized
}

async function callQuizLlm(
  req: GenerateQuizRequest,
  count: number,
  allowedTypes: QuestionType[],
  isRegenerate: boolean,
  compact = false
): Promise<QuizQuestion[]> {
  const client = await createClient()
  const content = truncateContent(req.chapterContent)
  const preset = req.quizPreset || 'all'
  const compactHint = compact
    ? '\n\n务必精简：explanation 每项不超过 50 字，题干简洁，确保 {"questions":[...]} 完整闭合。'
    : ''

  const response = await client.chat.completions.create({
    model: await getModel(),
    messages: [
      { role: 'system', content: buildQuizSystemPrompt(count, allowedTypes) + compactHint },
      {
        role: 'user',
        content: buildQuizUserMessage(
          req.chapterTitle,
          content,
          count,
          QUIZ_PRESET_LABELS[preset],
          allowedTypes,
          req.avoidQuestions
        ),
      },
    ],
    temperature: compact ? 0.3 : isRegenerate ? 0.9 : 0.5,
    max_tokens: Math.min(8192, Math.max(MAX_TOKENS_QUIZ, count * 450)),
  })

  const text = response.choices[0]?.message?.content || '{"questions":[]}'
  const finishReason = response.choices[0]?.finish_reason

  try {
    return parseQuizQuestionsFromResponse(text, allowedTypes)
  } catch (firstErr) {
    if (!compact) return callQuizLlm(req, count, allowedTypes, isRegenerate, true)
    if (finishReason === 'length') throw new Error('测验生成输出过长被截断，请减少题量后重试')
    throw firstErr
  }
}

export async function generateQuiz(req: GenerateQuizRequest): Promise<Quiz> {
  const count = clampQuestionCount(req.questionCount)
  const preset = req.quizPreset || 'all'
  const allowedTypes = getAllowedTypes(preset)
  const isRegenerate = !!(req.avoidQuestions && req.avoidQuestions.length > 0)

  let questions = validateQuizQuestions(
    await callQuizLlm(req, count, allowedTypes, isRegenerate),
    count,
    allowedTypes
  )

  if (questions.length < count) {
    questions = validateQuizQuestions(
      await callQuizLlm(req, count, allowedTypes, isRegenerate),
      count,
      allowedTypes
    )
  }

  if (questions.length < count) {
    throw new Error(
      `AI 仅生成了 ${questions.length} 道有效题目（需要 ${count} 道），请减少题量或更换题型后重试`
    )
  }

  questions = questions.slice(0, count).map((q, i) => ({ ...q, id: `q${i + 1}` }))

  const existing = queryOne<{ id: string }>('SELECT id FROM quizzes WHERE chapter_id = ?', [req.chapterId])
  const now = new Date().toISOString()
  let quizId: string
  if (existing) {
    quizId = existing.id
    runSql(`UPDATE quizzes SET questions_json = ?, created_at = ? WHERE id = ?`, [
      JSON.stringify(questions),
      now,
      quizId,
    ])
  } else {
    quizId = uuidv4()
    runSql(`INSERT INTO quizzes (id, chapter_id, questions_json) VALUES (?, ?, ?)`, [
      quizId,
      req.chapterId,
      JSON.stringify(questions),
    ])
  }

  return { id: quizId, chapterId: req.chapterId, questions, createdAt: now }
}

export async function gradeQuiz(req: GradeQuizRequest): Promise<{
  score: number
  results: { questionId: string; correct: boolean; feedback: string }[]
}> {
  const autoGraded = req.questions.filter(
    (q) => q.type === 'choice' || q.type === 'multi_choice' || q.type === 'fill'
  )
  const shortQuestions = req.questions.filter((q) => q.type === 'short')

  const autoResults = autoGraded.map((q) => {
    const userAnswer = req.answers.find((a) => a.questionId === q.id)?.answer || ''
    const correct =
      q.type === 'multi_choice'
        ? normalizeMultiAnswer(userAnswer) === normalizeMultiAnswer(q.correctAnswer)
        : normalizeAnswer(userAnswer) === normalizeAnswer(q.correctAnswer)
    return {
      questionId: q.id,
      correct,
      feedback: correct ? '回答正确' : `正确答案：${q.correctAnswer}. ${q.explanation}`,
    }
  })

  let shortResults: { questionId: string; correct: boolean; feedback: string }[] = []
  if (shortQuestions.length > 0) {
    const client = await createClient()
    const payload = shortQuestions.map((q) => ({
      questionId: q.id,
      question: q.question,
      correctAnswer: q.correctAnswer,
      userAnswer: req.answers.find((a) => a.questionId === q.id)?.answer || '',
      rubric: q.explanation,
    }))

    const response = await client.chat.completions.create({
      model: await getModel(),
      messages: [
        { role: 'system', content: GRADE_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0.3,
      max_tokens: MAX_TOKENS_GRADE,
    })

    const parsed = parseJsonFromResponse<{ results: typeof shortResults }>(
      response.choices[0]?.message?.content || '{"results":[]}'
    )
    shortResults = parsed.results
  }

  const allResults = [...autoResults, ...shortResults]
  const score = allResults.length > 0
    ? Math.round((allResults.filter((r) => r.correct).length / allResults.length) * 100)
    : 0

  return { score, results: allResults }
}

const MIN_VERBATIM_LEN = 8
const FALLBACK_EXCERPT_LEN = 200

function resolveWeakPointAnchor(
  raw: { chunkId?: string; verbatimQuote?: string; sourceExcerpt?: string },
  chunks: ChapterChunk[]
): { sourceExcerpt: string; anchorChunkId?: string; anchorQuote?: string } {
  const chunkId = raw.chunkId?.trim()
  const quote = (raw.verbatimQuote || raw.sourceExcerpt || '').trim()
  const chunk = chunkId ? chunks.find((c) => c.id === chunkId) : undefined

  if (chunk && quote.length >= MIN_VERBATIM_LEN && chunk.text.includes(quote)) {
    return { sourceExcerpt: quote, anchorChunkId: chunk.id, anchorQuote: quote }
  }

  if (chunk) {
    const fallback = chunk.text.slice(0, FALLBACK_EXCERPT_LEN).trim()
    if (fallback.length > 0) {
      return { sourceExcerpt: fallback, anchorChunkId: chunk.id, anchorQuote: fallback }
    }
  }

  if (chunks.length > 0) {
    const fallback = chunks[0].text.slice(0, FALLBACK_EXCERPT_LEN).trim()
    return { sourceExcerpt: fallback, anchorChunkId: chunks[0].id, anchorQuote: fallback }
  }

  return { sourceExcerpt: quote || '' }
}

function isVerbatimValid(
  raw: { chunkId?: string; verbatimQuote?: string; sourceExcerpt?: string },
  chunks: ChapterChunk[]
): boolean {
  const chunkId = raw.chunkId?.trim()
  const quote = (raw.verbatimQuote || raw.sourceExcerpt || '').trim()
  if (!chunkId || quote.length < MIN_VERBATIM_LEN) return false
  const chunk = chunks.find((c) => c.id === chunkId)
  return !!chunk && chunk.text.includes(quote)
}

type WeakPointLlmItem = {
  topic: string
  reason: string
  category?: string
  miniLesson: string
  chunkId?: string
  verbatimQuote?: string
  sourceExcerpt?: string
}

async function callWeakPointsLlm(
  wrongItems: WrongItemForRetrieval[],
  chunks: ChapterChunk[],
  teachingMode: string,
  compact = false
): Promise<WeakPointLlmItem[]> {
  const client = await createClient()
  const compactHint = compact
    ? '\n\n输出务必精简：miniLesson 每项不超过 100 字，reason 不超过 60 字，确保 JSON 数组完整闭合。'
    : ''
  const response = await client.chat.completions.create({
    model: await getModel(),
    messages: [
      {
        role: 'system',
        content: `${WEAK_POINTS_SYSTEM_PROMPT}\n\n请使用${teachingMode}风格编写 miniLesson。${compactHint}`,
      },
      { role: 'user', content: buildWeakPointsUserMessage(wrongItems, chunks) },
    ],
    temperature: 0.3,
    max_tokens: MAX_TOKENS_WEAK_POINTS,
  })

  const content = response.choices[0]?.message?.content || '[]'
  const finishReason = response.choices[0]?.finish_reason

  try {
    return parseJsonArrayFromResponse<WeakPointLlmItem>(content)
  } catch (firstErr) {
    if (!compact) return callWeakPointsLlm(wrongItems, chunks, teachingMode, true)
    if (finishReason === 'length') throw new Error('薄弱点分析输出过长被截断，请减少错题数量后重试')
    throw firstErr
  }
}

export async function analyzeWeakPoints(req: AnalyzeWeakPointsRequest): Promise<WeakPoint[]> {
  const wrongItems = req.results.filter((r) => !r.correct)
  if (wrongItems.length === 0) return []

  const teachingMode = req.teachingMode || (await getDefaultTeachingMode())
  const details: WrongItemForRetrieval[] = wrongItems.map((r) => {
    const q = req.questions.find((q) => q.id === r.questionId)
    const a = req.answers.find((a) => a.questionId === r.questionId)
    return {
      questionId: r.questionId,
      question: q?.question,
      correctAnswer: q?.correctAnswer,
      userAnswer: a?.answer,
      feedback: r.feedback,
    }
  })

  const chapterContent = req.chapterContent?.trim() || ''
  const chunks = chapterContent ? retrieveTopChunks(chapterContent, details, 3) : []

  let parsed = await callWeakPointsLlm(details, chunks, TEACHING_MODE_LABELS[teachingMode])

  const needsRetry = chunks.length > 0 && parsed.some((raw) => !isVerbatimValid(raw, chunks))
  if (needsRetry) {
    parsed = await callWeakPointsLlm(details, chunks, TEACHING_MODE_LABELS[teachingMode])
  }

  return parsed.map((wp) => {
    const anchor = resolveWeakPointAnchor(wp, chunks)
    return {
      topic: wp.topic,
      reason: wp.reason,
      category: (wp.category as WeakPoint['category']) || 'concept_confusion',
      miniLesson: wp.miniLesson,
      sourceExcerpt: anchor.sourceExcerpt || wp.topic,
      anchorChunkId: anchor.anchorChunkId,
      anchorQuote: anchor.anchorQuote,
    }
  })
}

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/^[a-d]\.\s*/i, '')
}

function normalizeMultiAnswer(s: string): string {
  return s
    .split('|')
    .map((part) => normalizeAnswer(part))
    .filter(Boolean)
    .sort()
    .join('|')
}

export function getQuizByChapter(chapterId: string): Quiz | null {
  const row = queryOne<{
    id: string
    chapter_id: string
    questions_json: string
    created_at: string
  }>('SELECT * FROM quizzes WHERE chapter_id = ?', [chapterId])
  if (!row) return null
  return {
    id: row.id,
    chapterId: row.chapter_id,
    questions: JSON.parse(row.questions_json),
    createdAt: row.created_at,
  }
}

export function saveQuizAttempt(data: {
  quizId: string
  answers: { questionId: string; answer: string }[]
  score: number
  weakPoints: WeakPoint[]
  results: { questionId: string; correct: boolean; feedback: string }[]
  timeTakenMs: number
}) {
  const id = uuidv4()
  const completedAt = new Date().toISOString()
  runSql(
    `INSERT INTO quiz_attempts (id, quiz_id, answers_json, score, weak_points_json, results_json, time_taken_ms, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.quizId, JSON.stringify(data.answers), data.score, JSON.stringify(data.weakPoints), JSON.stringify(data.results), data.timeTakenMs, completedAt]
  )
  return {
    id,
    quizId: data.quizId,
    answers: data.answers,
    score: data.score,
    weakPoints: data.weakPoints,
    results: data.results,
    timeTakenMs: data.timeTakenMs,
    completedAt,
    createdAt: completedAt,
  }
}

export function getQuizAttempts(quizId: string) {
  const rows = queryAll<{
    id: string
    quiz_id: string
    answers_json: string
    score: number
    weak_points_json: string
    results_json: string
    time_taken_ms: number
    completed_at: string
    created_at: string
  }>('SELECT * FROM quiz_attempts WHERE quiz_id = ? ORDER BY created_at DESC', [quizId])
  return rows.map((r) => ({
    id: r.id,
    quizId: r.quiz_id,
    answers: JSON.parse(r.answers_json),
    score: r.score,
    weakPoints: JSON.parse(r.weak_points_json),
    results: JSON.parse(r.results_json || '[]'),
    timeTakenMs: r.time_taken_ms || 0,
    completedAt: r.completed_at || r.created_at,
    createdAt: r.created_at,
  }))
}

export function getLatestQuizAttempt(quizId: string) {
  const attempts = getQuizAttempts(quizId)
  return attempts[0] || null
}

export function getQuizHistoryByChapter(chapterId: string) {
  const quiz = getQuizByChapter(chapterId)
  if (!quiz) return []
  return getQuizAttempts(quiz.id)
}
