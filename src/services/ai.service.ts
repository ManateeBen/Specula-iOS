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
  GenerateDigestRequest,
  ChapterDigest,
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
const MAX_TOKENS_DIGEST = 2600

type GeneratedDigest = Pick<ChapterDigest, 'title' | 'summary' | 'keyTerms' | 'question' | 'answerAnchor'>

interface DigestSource {
  id: string
  text: string
}

function sampleChapterContent(content: string, maxChars = 16000): string {
  if (content.length <= maxChars) return content
  const sectionCount = 7
  const sectionLength = Math.floor(maxChars / sectionCount)
  const maxStart = content.length - sectionLength
  return Array.from({ length: sectionCount }, (_, index) => {
    const start = Math.round((maxStart * index) / (sectionCount - 1))
    return content.slice(start, start + sectionLength)
  }).join('\n')
}

function buildDigestSources(content: string): DigestSource[] {
  const sampled = sampleChapterContent(content)
  const segments = sampled.match(/[^\n。！？.!?]+[。！？.!?]?/g) || [sampled]
  const sources: DigestSource[] = []
  for (const rawSegment of segments) {
    const segment = rawSegment.trim()
    if (Array.from(segment).length < 15) continue
    const characters = Array.from(segment)
    for (let offset = 0; offset < characters.length; offset += 76) {
      const text = characters.slice(offset, offset + 80).join('').trim()
      if (Array.from(text).length < 15 || !content.includes(text)) continue
      sources.push({ id: `S${sources.length}`, text })
      if (sources.length >= 220) return sources
    }
  }
  return sources
}

function normalizeGeneratedDigest(raw: unknown, sourceMap: Map<string, string>): GeneratedDigest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const summary = typeof value.summary === 'string' ? value.summary.trim() : ''
  const question = typeof value.question === 'string' ? value.question.trim() : ''
  const rawSourceId = value.source_id ?? value.sourceId ?? value.anchor_id ?? value.anchorId
  const sourceIdMatch = typeof rawSourceId === 'string' || typeof rawSourceId === 'number'
    ? String(rawSourceId).toUpperCase().match(/S?\d+/)?.[0]
    : undefined
  const sourceId = sourceIdMatch ? `S${sourceIdMatch.replace(/^S/, '')}` : ''
  const answerAnchor = sourceMap.get(sourceId)
    || (typeof value.answer_anchor === 'string' ? value.answer_anchor.trim() : '')
  const rawKeyTerms = value.key_terms ?? value.keyTerms
  const keyTerms = Array.isArray(rawKeyTerms)
    ? rawKeyTerms.filter((term): term is string => typeof term === 'string').map((term) => term.trim()).filter(Boolean).slice(0, 5)
    : []
  if (!title || !summary || !question || !answerAnchor) return null
  return { title, summary, keyTerms, question, answerAnchor }
}

function locallyValidateDigest(digest: GeneratedDigest, chapterContent: string): string | null {
  const summaryLength = Array.from(digest.summary.replace(/\s+/g, '')).length
  if (summaryLength > 160) return `summary 超过 160 字（当前 ${summaryLength} 字）`
  const sentences = digest.summary.split(/[。！？!?]+/).map((part) => part.trim()).filter(Boolean)
  if (sentences.length < 1 || sentences.length > 5) return 'summary 句数不合格'
  if (Array.from(digest.answerAnchor).length < 15 || Array.from(digest.answerAnchor).length > 80) {
    return 'answer_anchor 长度必须在 15-80 字符之间'
  }
  if (!chapterContent.includes(digest.answerAnchor)) return 'answer_anchor 未在章节原文中精确匹配'
  return null
}

function resolveExactAnchor(anchor: string, chapterContent: string): string {
  if (chapterContent.includes(anchor)) return anchor
  const contentChars = Array.from(chapterContent)
  const compactChars: string[] = []
  const sourceIndexes: number[] = []
  contentChars.forEach((character, index) => {
    if (/\s/.test(character)) return
    compactChars.push(character)
    sourceIndexes.push(index)
  })
  const compactAnchor = Array.from(anchor).filter((character) => !/\s/.test(character)).join('')
  if (!compactAnchor) return anchor
  const compactContent = compactChars.join('')
  const start = compactContent.indexOf(compactAnchor)
  if (start < 0) return anchor
  const sourceStart = sourceIndexes[start]
  const sourceEnd = sourceIndexes[start + Array.from(compactAnchor).length - 1]
  return contentChars.slice(sourceStart, sourceEnd + 1).join('').trim()
}

async function generateChapterDigestsLegacy(req: GenerateDigestRequest): Promise<GeneratedDigest[]> {
  const client = await createClient()
  const model = await getModel()
  const sources = buildDigestSources(req.chapterContent)
  const sourceMap = new Map(sources.map((source) => [source.id, source.text]))
  const sourceText = sources.map((source) => `[${source.id}] ${source.text}`).join('\n')
  if (sources.length < 3) return []
  let retryReason = ''
  const collected: GeneratedDigest[] = []
  const fallbackCandidates: GeneratedDigest[] = []

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `你为阅读 App 的一个章节生成 5 张彼此独立的“快速浏览”知识卡。
要求：
1. 5 张卡覆盖本章最核心、最值得记住且互不重复的概念、机制或判断，并按重要性排序；不要按段落机械切分。
2. 每张 summary 只讲结论（what），2-4 句且不超过 120 字，绝不泄露原因或机制。
3. question 只追问为什么、凭什么、代价、边界或成立条件（why）。读者看完 summary 会觉得自己懂了，但不能仅凭 summary 回答 question。
4. source_id 必须选择下方原文片段已有的编号，该片段应能回答 question。禁止编造编号或复制改写原文。
5. 每张卡独立成立，不得出现“上一张”“如下文”等依赖其他卡片的表达。
只输出 JSON：{"cards":[{"title":"核心概念标题","summary":"结论","key_terms":["术语"],"question":"机制拷问","source_id":"S0"}]}`,
          },
          {
            role: 'user',
            content: `章节：${req.chapterTitle}\n${collected.length ? `已经采用的标题：${collected.map((item) => item.title).join('、')}\n请生成不同核心概念。\n` : ''}${retryReason ? `上次问题：${retryReason}\n` : ''}\n可选原文片段：\n${sourceText}`,
          },
        ],
        temperature: attempt === 0 ? 0.4 : 0.65,
        max_tokens: MAX_TOKENS_DIGEST,
      })
    } catch (error) {
      retryReason = error instanceof Error ? error.message : '模型调用失败'
      continue
    }

    let candidates: GeneratedDigest[] = []
    try {
      const parsed = parseJsonFromResponse<{ cards?: unknown[] } | unknown[]>(response.choices[0]?.message?.content || '')
      const rawCards = Array.isArray(parsed) ? parsed : parsed.cards || []
      candidates = rawCards
        .map((item) => normalizeGeneratedDigest(item, sourceMap))
        .filter((item): item is GeneratedDigest => item !== null)
    } catch {
      retryReason = '返回内容不是合法 JSON'
      continue
    }
    if (candidates.length === 0) {
      retryReason = '没有返回字段完整且 source_id 有效的卡片'
      continue
    }
    const resolvedCandidates = candidates.map((digest) => ({
      ...digest,
      answerAnchor: resolveExactAnchor(digest.answerAnchor, req.chapterContent),
    }))
    const locallyValid = resolvedCandidates.filter((digest) => !locallyValidateDigest(digest, req.chapterContent))
    const unique = locallyValid.filter((digest, index, items) => {
      const duplicateInBatch = items.findIndex((item) => item.title === digest.title || item.question === digest.question) !== index
      const duplicateCollected = collected.some((item) => item.title === digest.title || item.question === digest.question)
      return !duplicateInBatch && !duplicateCollected
    })
    if (unique.length === 0) {
      const errors = resolvedCandidates
        .map((digest) => locallyValidateDigest(digest, req.chapterContent))
        .filter(Boolean)
      retryReason = `本地校验没有新增卡片：${errors.slice(0, 3).join('；') || '核心概念或锚点重复'}`
      continue
    }
    fallbackCandidates.push(...unique.filter((digest) =>
      !fallbackCandidates.some((item) => item.title === digest.title || item.question === digest.question)
    ))

    const judge = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: '你是严格的信息泄漏校验器。逐张判断仅凭 summary 是否足以回答 question。若 summary 已包含问题要求的原因、机制、代价、边界或条件，answerable 为 true。只输出 JSON：{"results":[{"card_index":0,"answerable":true或false,"reason":"原因"}]}。',
        },
        {
          role: 'user',
          content: JSON.stringify(unique.map((digest, cardIndex) => ({
            card_index: cardIndex,
            summary: digest.summary,
            question: digest.question,
          }))),
        },
      ],
      temperature: 0,
      max_tokens: 700,
    })
    try {
      const result = parseJsonFromResponse<{
        results?: { card_index?: number; answerable?: boolean; reason?: string }[]
      }>(judge.choices[0]?.message?.content || '')
      if (!Array.isArray(result.results)) throw new Error('校验结果不完整')
      const accepted = unique.filter((_, index) =>
        result.results?.find((item) => Number(item.card_index) === index)?.answerable !== true
      )
      collected.push(...accepted)
      retryReason = `本轮采用 ${accepted.length} 张，还需补充不同的核心概念`
    } catch {
      // The judge improves quality but must not make an otherwise valid chapter unusable.
      collected.push(...unique)
      retryReason = '质量复核格式异常，已保留通过本地校验的卡片'
    }
    if (collected.length >= 3) return collected.slice(0, 5)
  }
  const combined = [
    ...collected,
    ...fallbackCandidates.filter((digest) =>
      !collected.some((item) => item.title === digest.title || item.question === digest.question)
    ),
  ]
  if (combined.length < 3) {
    throw new Error(`仅生成 ${combined.length} 张有效卡片：${retryReason || '模型返回内容不足'}`)
  }
  return combined.slice(0, 5)
}

interface ChapterKnowledgePoint {
  name: string
  whyCore: string
  sourceIds: string[]
  priority: number
}

function normalizeDigestSourceId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const match = String(value).toUpperCase().match(/S?\d+/)?.[0]
  return match ? `S${match.replace(/^S/, '')}` : null
}

function normalizeKnowledgePlan(raw: unknown, sourceMap: Map<string, string>): ChapterKnowledgePoint[] {
  if (!raw || typeof raw !== 'object') return []
  const value = raw as { concepts?: unknown[] }
  if (!Array.isArray(value.concepts)) return []

  const concepts = value.concepts.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const concept = item as Record<string, unknown>
    const name = typeof concept.name === 'string' ? concept.name.trim() : ''
    const whyCoreValue = concept.why_core ?? concept.whyCore
    const whyCore = typeof whyCoreValue === 'string' ? whyCoreValue.trim() : ''
    const sourceValues = concept.source_ids ?? concept.sourceIds
    const sourceIds = Array.isArray(sourceValues)
      ? [...new Set(sourceValues
        .map(normalizeDigestSourceId)
        .filter((id): id is string => Boolean(id && sourceMap.has(id))))]
      : []
    if (!name || !whyCore || sourceIds.length === 0) return []
    const priorityValue = Number(concept.priority)
    return [{
      name,
      whyCore,
      sourceIds: sourceIds.slice(0, 8),
      priority: Number.isFinite(priorityValue) ? priorityValue : index + 1,
    }]
  })

  return concepts
    .filter((concept, index, items) => items.findIndex((item) => item.name === concept.name) === index)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5)
}

function selectSourcesForPlan(plan: ChapterKnowledgePoint[], sources: DigestSource[]): DigestSource[] {
  const selectedIndexes = new Set<number>()
  const indexById = new Map(sources.map((source, index) => [source.id, index]))
  plan.forEach((concept) => concept.sourceIds.forEach((sourceId) => {
    const index = indexById.get(sourceId)
    if (index === undefined) return
    selectedIndexes.add(index)
    if (index > 0) selectedIndexes.add(index - 1)
    if (index + 1 < sources.length) selectedIndexes.add(index + 1)
  }))
  return [...selectedIndexes].sort((a, b) => a - b).map((index) => sources[index])
}

async function createChapterKnowledgePlan(
  client: OpenAI,
  model: string,
  chapterTitle: string,
  sourceText: string,
  sourceMap: Map<string, string>,
): Promise<ChapterKnowledgePoint[]> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `你是资深非虚构图书编辑。先识别一章真正值得读者带走的知识骨架，不要直接写摘要或题目。
要求：
1. 根据章节知识密度选出 3-5 个核心知识点，并按重要性排序；不是固定凑满 5 个。
2. 优先选择贯穿本章的概念、机制、模型、因果链、成立条件、边界或关键权衡。
3. 排除章节导语、作者寒暄、目录式概述、重复表述、孤立案例、练习题和不影响主旨的细节；案例只有在承载核心规律时才可入选。
4. 各知识点必须彼此独立且合起来覆盖本章论证主干，不能只是同一概念的不同措辞。
5. source_ids 必须引用下方已有原文编号，且应足以支持该知识点的核心结论与机制。
只输出 JSON：{"concepts":[{"name":"知识点名称","why_core":"它为何属于本章主干","source_ids":["S0"],"priority":1}]}`,
      },
      {
        role: 'user',
        content: `章节：${chapterTitle}\n\n候选原文片段：\n${sourceText}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 1400,
  })
  const parsed = parseJsonFromResponse<unknown>(response.choices[0]?.message?.content || '')
  const plan = normalizeKnowledgePlan(parsed, sourceMap)
  return plan.length >= 3 ? plan : []
}

export async function generateChapterDigests(req: GenerateDigestRequest): Promise<GeneratedDigest[]> {
  const client = await createClient()
  const model = await getModel()
  const sources = buildDigestSources(req.chapterContent)
  if (sources.length < 3) return []
  const sourceMap = new Map(sources.map((source) => [source.id, source.text]))
  const sourceText = sources.map((source) => `[${source.id}] ${source.text}`).join('\n')

  let plan: ChapterKnowledgePoint[] = []
  try {
    plan = await createChapterKnowledgePlan(client, model, req.chapterTitle, sourceText, sourceMap)
  } catch {
    return generateChapterDigestsLegacy(req)
  }
  if (plan.length < 3) return generateChapterDigestsLegacy(req)

  const targetCount = plan.length
  const plannedSources = selectSourcesForPlan(plan, sources)
  const plannedSourceText = plannedSources.map((source) => `[${source.id}] ${source.text}`).join('\n')
  const accepted: GeneratedDigest[] = []
  const fallback: GeneratedDigest[] = []
  let retryReason = ''

  for (let attempt = 0; attempt < 3 && accepted.length < targetCount; attempt += 1) {
    const remainingPlan = plan.filter((concept) =>
      !accepted.some((card) => card.title === concept.name)
    )
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `你是阅读 App 的核心知识卡编辑。知识策划已完成，请严格根据策划生成卡片。
要求：
1. 每个策划知识点生成且只生成一张卡，保持策划顺序；标题优先使用策划名称，不得换成章节名或泛泛标题。
2. summary 用 2-4 句、120 字以内说清“它是什么、核心结论是什么、在本章中有什么作用”，不写铺垫和案例细节。
3. summary 只给结论（what），不得泄露问题所问的原因、机制、代价、边界或成立条件。
4. question 必须追问该知识点最关键的 why：为什么成立、如何运作、边界在哪里、代价是什么。禁止“什么是……”式复述题，且不能仅凭 summary 回答。
5. source_id 必须使用候选原文已有编号，并选择能直接回答 question 的片段。
6. 每张卡独立成立，不得引用“上一张”“前面”等其他卡片。
只输出 JSON：{"cards":[{"title":"策划知识点名称","summary":"结论","key_terms":["术语"],"question":"机制拷问","source_id":"S0"}]}`,
        },
        {
          role: 'user',
          content: `章节：${req.chapterTitle}
本轮知识策划（必须逐项制卡）：${JSON.stringify(remainingPlan)}
${retryReason ? `上轮问题：${retryReason}\n` : ''}
候选原文片段：\n${plannedSourceText}`,
        },
      ],
      temperature: attempt === 0 ? 0.35 : 0.55,
      max_tokens: MAX_TOKENS_DIGEST,
    })

    let candidates: GeneratedDigest[] = []
    try {
      const parsed = parseJsonFromResponse<{ cards?: unknown[] } | unknown[]>(response.choices[0]?.message?.content || '')
      const rawCards = Array.isArray(parsed) ? parsed : parsed.cards || []
      candidates = rawCards
        .map((item) => normalizeGeneratedDigest(item, sourceMap))
        .filter((item): item is GeneratedDigest => item !== null)
        .map((digest) => ({
          ...digest,
          answerAnchor: resolveExactAnchor(digest.answerAnchor, req.chapterContent),
        }))
        .filter((digest) => !locallyValidateDigest(digest, req.chapterContent))
        .filter((digest, index, items) =>
          items.findIndex((item) => item.title === digest.title || item.question === digest.question) === index
          && !accepted.some((item) => item.title === digest.title || item.question === digest.question)
        )
    } catch {
      retryReason = '返回内容不是合法 JSON'
      continue
    }
    if (candidates.length === 0) {
      retryReason = '没有生成字段完整、锚点有效且互不重复的卡片'
      continue
    }
    fallback.push(...candidates.filter((candidate) =>
      !fallback.some((item) => item.title === candidate.title || item.question === candidate.question)
    ))

    try {
      const judge = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: '逐张检查：仅凭 summary 是否足以回答 question。若摘要已经包含问题要求的原因、机制、代价、边界或条件，answerable 为 true。只输出 JSON：{"results":[{"card_index":0,"answerable":false,"reason":"原因"}]}。',
          },
          {
            role: 'user',
            content: JSON.stringify(candidates.map((card, cardIndex) => ({
              card_index: cardIndex,
              summary: card.summary,
              question: card.question,
            }))),
          },
        ],
        temperature: 0,
        max_tokens: 700,
      })
      const judged = parseJsonFromResponse<{
        results?: { card_index?: number; answerable?: boolean }[]
      }>(judge.choices[0]?.message?.content || '')
      const passed = candidates.filter((_, index) =>
        judged.results?.find((result) => Number(result.card_index) === index)?.answerable !== true
      )
      accepted.push(...passed)
      retryReason = `还缺 ${Math.max(0, targetCount - accepted.length)} 张策划知识卡`
    } catch {
      accepted.push(...candidates)
      retryReason = '质量复核格式异常，已保留通过本地校验的卡片'
    }
  }

  const combined = [
    ...accepted,
    ...fallback.filter((candidate) =>
      !accepted.some((item) => item.title === candidate.title || item.question === candidate.question)
    ),
  ].slice(0, targetCount)
  return combined.length >= 3 ? combined : generateChapterDigestsLegacy(req)
}

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
