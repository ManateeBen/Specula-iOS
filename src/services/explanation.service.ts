import OpenAI from 'openai'
import { LocalNotifications } from '@capacitor/local-notifications'
import { v4 as uuidv4 } from 'uuid'
import type {
  ExplainNeedRequest,
  ExplanationNeed,
  ExplanationSection,
  ExplanationTail,
  InferredExplanationNeed,
  StructuredExplanation,
} from '../types'
import { queryAll, queryOne, runSql } from './db'
import { getTextConfig } from './settings.service'

const NEED_INSTRUCTIONS: Record<ExplanationNeed, string> = {
  not_understood: `任务：让零基础读者建立直觉。
1. 第一节用一个与原文机制严格同构的生活化类比。
2. 第二节把类比逐项对应回原文术语和数字。
3. 禁止使用“用户已掌握”之外的新术语；必须出现的术语要当场用大白话定义。
tail 必须是 {"type":"check","question":"一道可从解释直接推出的是非题","answer":true或false,"feedback_right":"确认和一句强化","feedback_wrong":"温和纠正并复述机制，可提到押错更容易记住"}。`,
  clarify: `任务：消除似懂非懂。
1. 第一节标签固定为“你可能卡在哪”，点出一个常见误解并澄清。
2. 第二节讲边界条件：结论何时不成立、依赖什么前提。
3. 不重复原文已经说清楚的部分。
tail 必须是 {"type":"deeper","question":"与本章后文或相邻概念相关的自然追问"}。`,
  memorize: `任务：压缩为记忆锚点。
1. 第一节标签固定为“一句话锚点”，给一句 15 字内的口诀或意象。
2. 第二节标签固定为“三个要点”，使用 ①②③，每点一行，保留关键数字。
tail 必须是 {"type":"flashcard","front":"考察本质的问题，不是名词解释","back":"20 字内答案要点，可含关键数字"}。`,
  why_design: `任务：讲清设计权衡。
1. 第一节标签固定为“当年的权衡”，说明优化目标和约束。
2. 第二节标签固定为“被放弃的方案”，说明更直接的方案及不用它的原因。
3. 若属于通用模式，点明模式名；原文无依据时明确说无法确定历史事实。
tail 必须是 {"type":"pattern","question":"邀请联想该模式在其他领域的出现，并给 2-3 个提示"}。`,
  apply: `任务：落到行动，默认用户是软件工程师。
1. 第一节标签固定为“工作里怎么用”，给具体场景和配置项、命令或操作对象。
2. 第二节标签固定为“迁移这个思想”，指出可迁移到用户系统的地方。
tail 必须是 {"type":"action","task":"一个 5 分钟内可完成、以动词开头的小动作"}。`,
}

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function getSelectionHash(text: string, followUp = ''): string {
  return hashText(`${text.trim()}\n${followUp.trim()}`)
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function normalizeSections(value: unknown): ExplanationSection[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 12) : ''
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    return label && text ? [{ label, text }] : []
  }).slice(0, 4)
}

function normalizeTail(value: unknown): ExplanationTail {
  if (!value || typeof value !== 'object') return { type: 'none' }
  const tail = value as Record<string, unknown>
  const text = (key: string) => typeof tail[key] === 'string' ? String(tail[key]).trim() : ''
  if (tail.type === 'check' && text('question')) {
    return {
      type: 'check',
      question: text('question'),
      answer: tail.answer === true || tail.answer === 'true',
      feedbackRight: text('feedback_right') || text('feedbackRight') || '答对了，你已经抓住了核心机制。',
      feedbackWrong: text('feedback_wrong') || text('feedbackWrong') || '再看一眼上面的对应关系。押错一次，往往更容易记住。',
    }
  }
  if (tail.type === 'deeper' && text('question')) return { type: 'deeper', question: text('question') }
  if (tail.type === 'flashcard' && text('front')) return { type: 'flashcard', front: text('front'), back: text('back') }
  if (tail.type === 'pattern' && text('question')) return { type: 'pattern', question: text('question') }
  if (tail.type === 'action' && text('task')) return { type: 'action', task: text('task') }
  return { type: 'none' }
}

function normalizeExplanation(raw: string): StructuredExplanation {
  const parsed = parseJsonObject(raw)
  const sections = normalizeSections(parsed?.sections)
  if (!sections.length) {
    return {
      sections: [{ label: 'AI 解释', text: raw.trim() || '暂时无法生成解释，请稍后重试。' }],
      tail: { type: 'none' },
      fallback: true,
      fromCache: false,
    }
  }
  return { sections, tail: normalizeTail(parsed?.tail), fallback: false, fromCache: false }
}

function getChapterContext(chapterId: string | null): { summary: string; knownConcepts: string } {
  if (!chapterId) return { summary: '', knownConcepts: '' }
  const summaries = queryAll<{ summary: string }>(
    `SELECT summary FROM quick_browse_cards WHERE chapter_id = ? ORDER BY card_index LIMIT 5`,
    [chapterId]
  ).map((row) => row.summary)
  const concepts = queryAll<{ key_terms_json: string }>(
    `SELECT c.key_terms_json FROM quick_browse_cards c
     JOIN quick_browse_card_answers a ON a.card_id = c.id
     WHERE c.chapter_id = ? AND a.status IN ('confident', 'repaired')`,
    [chapterId]
  ).flatMap((row) => {
    try { return JSON.parse(row.key_terms_json) as string[] } catch { return [] }
  })
  return {
    summary: summaries.join('；').slice(0, 800),
    knownConcepts: [...new Set(concepts)].slice(0, 20).join('、'),
  }
}

function buildPrompt(req: ExplainNeedRequest): string {
  const { summary, knownConcepts } = getChapterContext(req.chapterId)
  const tone = req.tone === 'casual' ? '轻松、自然，但不油滑' : '严谨、清晰、克制'
  const repeatRule = req.followUp
    ? `这是一次追问。追问内容：${req.followUp}\n直接回应追问，并保持与前文一致。`
    : ''
  return `用户选中的原文：\n${req.selectedText}\n\n选中处之前的上下文：\n${req.contextBefore || '无'}
\n本章主旨：${summary || req.chapterTitle || '无预处理数据'}
\n用户已掌握的概念：${knownConcepts || '无数据'}
\n${repeatRule}
\n${NEED_INSTRUCTIONS[req.need]}
\n只输出一个合法 JSON 对象：
{"sections":[{"label":"6字内小节标签","text":"段落内容"}],"tail":{}}
sections 为 2-3 节，总字数不超过 250 个汉字；可以用 <b> 标记关键短语，每节至多一处。
语气：${tone}。不得编造原文没有依据的事实，论断必须能在给出的原文和上下文中找到支撑。不要输出 Markdown 代码围栏。`
}

function track(bookId: string, chapterId: string | null, eventName: string, properties: Record<string, unknown>): void {
  runSql(
    `INSERT INTO analytics_events (id, book_id, chapter_id, event_name, properties_json) VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), bookId, chapterId, eventName, JSON.stringify(properties)]
  )
}

export function inferNeed(bookId: string, selectedText: string): InferredExplanationNeed | null {
  const selectionHash = getSelectionHash(selectedText)
  const row = queryOne<{ request_count: number }>(
    `SELECT request_count FROM ai_selection_history WHERE book_id = ? AND selection_hash = ?`,
    [bookId, selectionHash]
  )
  runSql(
    `INSERT INTO ai_selection_history (book_id, selection_hash, request_count) VALUES (?, ?, 1)
     ON CONFLICT(book_id, selection_hash) DO UPDATE SET request_count = request_count + 1, updated_at = datetime('now')`,
    [bookId, selectionHash]
  )
  if (row?.request_count) return { need: 'not_understood', reason: '再讲一次，换个讲法' }
  if (selectedText.trim().length >= 4) return { need: 'not_understood', reason: '你第一次遇到这个概念' }
  return null
}

export async function explainNeed(req: ExplainNeedRequest): Promise<StructuredExplanation> {
  const selectionHash = getSelectionHash(req.selectedText, req.followUp)
  const cached = queryOne<{ result_json: string }>(
    `SELECT result_json FROM ai_explanation_cache WHERE book_id = ? AND selection_hash = ? AND need = ? AND tone = ?`,
    [req.bookId, selectionHash, req.need, req.tone]
  )
  if (cached) {
    try {
      const result = JSON.parse(cached.result_json) as StructuredExplanation
      track(req.bookId, req.chapterId, 'ai_explanation_cache_hit', { need: req.need, tone: req.tone })
      return { ...result, fromCache: true }
    } catch { /* regenerate a corrupt cache row */ }
  }

  const config = await getTextConfig()
  if (!config.apiKey) throw new Error('应用未配置内置文本模型凭据')
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, dangerouslyAllowBrowser: true })
  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: '你是阅读应用 Specula 的讲解编辑。严格遵守用户给出的 JSON 协议。' },
      { role: 'user', content: buildPrompt(req) },
    ],
    temperature: 0.55,
    max_tokens: 1400,
  })
  const raw = response.choices[0]?.message?.content || ''
  const result = normalizeExplanation(raw)
  runSql(
    `INSERT OR REPLACE INTO ai_explanation_cache
     (id, book_id, selection_hash, need, tone, result_json) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), req.bookId, selectionHash, req.need, req.tone, JSON.stringify(result)]
  )
  track(req.bookId, req.chapterId, 'ai_explanation_generated', {
    need: req.need,
    tone: req.tone,
    fallback: result.fallback,
    tokens: response.usage?.total_tokens || null,
  })
  return result
}

export function recordNeedSwitch(data: {
  bookId: string
  chapterId: string | null
  inferredNeed: ExplanationNeed | null
  from: ExplanationNeed
  to: ExplanationNeed
}): void {
  track(data.bookId, data.chapterId, 'ai_need_switched', data)
}

function tomorrowAtNine(): Date {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date
}

export function markNeedsReview(data: {
  bookId: string
  chapterId: string | null
  selectedText: string
  question: string
}): void {
  runSql(
    `INSERT INTO review_cards (id, book_id, chapter_id, source_text, front, back, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), data.bookId, data.chapterId, data.selectedText, data.question, data.selectedText.slice(0, 180), new Date().toISOString()]
  )
  track(data.bookId, data.chapterId, 'ai_check_wrong', {})
}

export function saveFlashcard(data: {
  bookId: string
  chapterId: string | null
  selectedText: string
  front: string
  back: string
}): void {
  runSql(
    `INSERT INTO review_cards (id, book_id, chapter_id, source_text, front, back, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), data.bookId, data.chapterId, data.selectedText, data.front, data.back, tomorrowAtNine().toISOString()]
  )
  track(data.bookId, data.chapterId, 'ai_flashcard_saved', {})
}

export function saveExploration(data: {
  bookId: string
  chapterId: string | null
  selectedText: string
  question: string
}): void {
  runSql(
    `INSERT INTO exploration_items (id, book_id, chapter_id, source_text, question) VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), data.bookId, data.chapterId, data.selectedText, data.question]
  )
  track(data.bookId, data.chapterId, 'ai_pattern_saved', {})
}

export async function createLearningTask(data: {
  bookId: string
  chapterId: string | null
  task: string
}): Promise<void> {
  const remindAt = tomorrowAtNine()
  const id = uuidv4()
  const permission = await LocalNotifications.checkPermissions()
  const status = permission.display === 'prompt'
    ? await LocalNotifications.requestPermissions()
    : permission
  if (status.display !== 'granted') throw new Error('需要允许通知，才能在明天提醒这个任务')
  const notificationId = Math.max(1, Math.floor(Math.random() * 2_000_000_000))
  await LocalNotifications.schedule({
    notifications: [{
      id: notificationId,
      title: 'Specula · 5 分钟行动',
      body: data.task,
      schedule: { at: remindAt },
      extra: { learningTaskId: id, bookId: data.bookId },
    }],
  })
  runSql(
    `INSERT INTO learning_tasks (id, book_id, chapter_id, task, remind_at) VALUES (?, ?, ?, ?, ?)`,
    [id, data.bookId, data.chapterId, data.task, remindAt.toISOString()]
  )
  track(data.bookId, data.chapterId, 'ai_action_claimed', { remindAt: remindAt.toISOString() })
}
