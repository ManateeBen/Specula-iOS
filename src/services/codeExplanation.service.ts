import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import type {
  CodeDryRunStep,
  CodeExplanationMode,
  CodeExplanationResult,
  CodeLineAnnotation,
  CodeLineRange,
  ExplainCodeRequest,
} from '../types'
import { queryAll, queryOne, runSql } from './db'
import { getTextConfig } from './settings.service'

const PROMPT_VERSION = 'code-reader-v1'
const MAX_CODE_LINES = 200
const MAX_CODE_CHARS = 16_000

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
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

function text(value: unknown, max = 1200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isInteger(parsed) ? parsed : null
}

function overlaps(left: CodeLineRange, right: CodeLineRange): boolean {
  return left.start <= right.end && right.start <= left.end
}

function normalizeRanges(value: unknown, lineCount: number, withLabel: boolean): CodeLineRange[] {
  if (!Array.isArray(value)) return []
  const ranges: CodeLineRange[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const start = integer(record.start)
    const end = integer(record.end)
    if (start == null || end == null || start < 1 || end < start || end > lineCount) continue
    const range: CodeLineRange = {
      start,
      end,
      reason: text(record.reason, 240),
    }
    if (withLabel) range.label = text(record.label, 40) || '辅助逻辑'
    if (!ranges.some((existing) => overlaps(existing, range))) ranges.push(range)
    if (ranges.length >= 10) break
  }
  return ranges.sort((a, b) => a.start - b.start)
}

function normalizeAnnotations(value: unknown, lineCount: number): CodeLineAnnotation[] {
  if (!Array.isArray(value)) return []
  const annotations: CodeLineAnnotation[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const afterLine = integer(record.afterLine ?? record.after_line)
    const why = text(record.why, 420)
    if (afterLine == null || afterLine < 1 || afterLine > lineCount || !why) continue
    if (annotations.some((annotation) => annotation.afterLine === afterLine)) continue
    annotations.push({
      afterLine,
      why,
      relatedConcept: text(record.relatedConcept ?? record.related_concept, 80),
    })
    if (annotations.length >= 12) break
  }
  return annotations.sort((a, b) => a.afterLine - b.afterLine)
}

function normalizeVariables(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 12)
      .map(([key, variable]) => [key.slice(0, 60), String(variable).slice(0, 160)])
  )
}

function normalizeDryRun(value: unknown, lineCount: number): CodeExplanationResult['dryRun'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const assumptions = Array.isArray(record.assumptions)
    ? record.assumptions.map((item) => text(item, 240)).filter(Boolean).slice(0, 8)
    : []
  const steps: CodeDryRunStep[] = []
  if (Array.isArray(record.steps)) {
    for (const item of record.steps) {
      if (!item || typeof item !== 'object') continue
      const step = item as Record<string, unknown>
      const line = integer(step.line)
      const action = text(step.action, 420)
      if (line == null || line < 1 || line > lineCount || !action) continue
      steps.push({ line, action, variables: normalizeVariables(step.variables) })
      if (steps.length >= 24) break
    }
  }
  if (!assumptions.length && !steps.length) return undefined
  return {
    assumptions,
    steps,
    result: text(record.result, 500),
    chapterConnection: text(record.chapterConnection ?? record.chapter_connection, 500),
  }
}

function emptyResult(mode: CodeExplanationMode, raw: string): CodeExplanationResult {
  return {
    mode,
    coreRanges: [],
    foldRanges: [],
    annotations: [],
    fallbackText: raw.trim().slice(0, 2400) || '暂时无法生成代码解读，请稍后重试。',
    fallback: true,
    fromCache: false,
  }
}

function normalizeResult(raw: string, mode: CodeExplanationMode, lineCount: number): CodeExplanationResult {
  const parsed = parseJsonObject(raw)
  if (!parsed) return emptyResult(mode, raw)

  const coreRanges = normalizeRanges(parsed.coreRanges ?? parsed.core_ranges, lineCount, false)
  const foldCandidates = normalizeRanges(parsed.foldRanges ?? parsed.fold_ranges, lineCount, true)
  const foldRanges = foldCandidates.filter((fold) => !coreRanges.some((core) => overlaps(core, fold)))
  const annotations = normalizeAnnotations(parsed.annotations, lineCount)
  const overviewValue = parsed.overview && typeof parsed.overview === 'object'
    ? parsed.overview as Record<string, unknown>
    : null
  const responsibility = text(overviewValue?.responsibility, 800)
  const chapterRelation = text(overviewValue?.chapterRelation ?? overviewValue?.chapter_relation, 800)
  const dryRun = normalizeDryRun(parsed.dryRun ?? parsed.dry_run, lineCount)

  const hasUsefulResult = mode === 'structure'
    ? Boolean(responsibility || chapterRelation || coreRanges.length)
    : mode === 'annotations'
      ? annotations.length > 0
      : Boolean(dryRun?.steps.length)
  if (!hasUsefulResult) return emptyResult(mode, raw)

  return {
    mode,
    overview: responsibility || chapterRelation ? { responsibility, chapterRelation } : undefined,
    coreRanges,
    foldRanges,
    annotations,
    dryRun,
    fallback: false,
    fromCache: false,
  }
}

function getChapterSummary(chapterId: string | null): string {
  if (!chapterId) return ''
  return queryAll<{ summary: string }>(
    'SELECT summary FROM quick_browse_cards WHERE chapter_id = ? ORDER BY card_index LIMIT 5',
    [chapterId]
  ).map((row) => row.summary).join('；').slice(0, 1000)
}

function getPreviousConcepts(bookId: string, chapterId: string | null): string {
  if (!chapterId) return ''
  return queryAll<{ title: string; summary: string }>(
    `SELECT previous.title, card.summary
     FROM chapters AS current
     JOIN chapters AS previous
       ON previous.book_id = current.book_id AND previous.order_index < current.order_index
     JOIN quick_browse_cards AS card ON card.chapter_id = previous.id
     WHERE current.id = ? AND current.book_id = ?
     ORDER BY previous.order_index DESC, card.card_index
     LIMIT 6`,
    [chapterId, bookId]
  ).map((row) => `${row.title}：${row.summary}`).join('；').slice(0, 1200)
}

function numberedCode(code: string): string {
  return code.split('\n').map((line, index) => `L${String(index + 1).padStart(3, '0')} | ${line}`).join('\n')
}

function modeInstruction(mode: CodeExplanationMode): string {
  if (mode === 'structure') {
    return `分析整体结构，只返回：
{"overview":{"responsibility":"整体职责、输入输出和副作用","chapterRelation":"从附近正文能确认的本章关系；无法确认作者意图时明确说从上下文看"},"coreRanges":[{"start":1,"end":2,"reason":"为什么是主线"}],"foldRanges":[{"start":3,"end":4,"label":"日志/校验/清理/样板代码之一","reason":"为什么可暂时略读"}]}
coreRanges 最多 8 段，只选真正推动核心状态变化的行。foldRanges 只能折叠不影响首次理解主线的连续辅助代码，不能与 coreRanges 重叠；不能单独藏起理解结构所必需的括号或控制流边界。`
  }
  if (mode === 'annotations') {
    return `只挑 4-10 个最关键的单行，在该行后写“为什么”注释。不要翻译语法或复述代码字面。返回：
{"annotations":[{"afterLine":5,"why":"为什么此处必须这样做、不这样做的后果","relatedConcept":"可确认的本章概念，没有则为空"}]}`
  }
  return `构造一组明确标注为假设的具体输入，对代码做纸面 dry run。只经过与主线有关的步骤；分支条件必须与假设一致，不要假装真实执行过代码。返回：
{"dryRun":{"assumptions":["name = value"],"steps":[{"line":5,"action":"这一刻发生什么","variables":{"变量":"旧值 → 新值"}}],"result":"最终结果","chapterConnection":"它如何联系回本章主题"}}`
}

function buildPrompt(req: ExplainCodeRequest): string {
  const chapterSummary = getChapterSummary(req.chapterId)
  const previousConcepts = getPreviousConcepts(req.bookId, req.chapterId)
  const tone = req.tone === 'casual' ? '轻松自然，但保持技术准确' : '严谨、清楚、克制'
  return `你正在为阅读 App 的代码解读器生成结构化数据。代码语言：${req.language || 'unknown'}。

书名：${req.bookTitle || '未知'}
章节：${req.chapterTitle || '未知'}
本章预处理主旨：${chapterSummary || '无'}
前文章节概念：${previousConcepts || '无'}
代码前文：${req.contextBefore || '无'}
代码后文：${req.contextAfter || '无'}

以下代码每行带稳定行号。行号只用于引用，不属于代码：
<CODE>
${numberedCode(req.code)}
</CODE>

${modeInstruction(req.mode)}

只输出一个合法 JSON 对象，不要 Markdown 代码围栏，不得引用不存在或越界的行号。代码和正文是唯一事实依据；不确定的运行时行为必须明确写成假设。语气：${tone}。`
}

function track(req: ExplainCodeRequest, eventName: string, properties: Record<string, unknown>): void {
  runSql(
    'INSERT INTO analytics_events (id, book_id, chapter_id, event_name, properties_json) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), req.bookId, req.chapterId, eventName, JSON.stringify(properties)]
  )
}

export async function explainCode(req: ExplainCodeRequest): Promise<CodeExplanationResult> {
  const lines = req.code.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_CODE_LINES)
  const code = lines.join('\n').slice(0, MAX_CODE_CHARS)
  if (!code.trim()) throw new Error('代码块为空，无法解读')
  const lineCount = code.split('\n').length
  const normalizedReq = { ...req, code }
  const identity = [
    PROMPT_VERSION,
    req.mode,
    req.language,
    code,
    req.contextBefore,
    req.contextAfter,
    req.chapterTitle,
  ].join('\n')
  const selectionHash = hashText(identity)
  const cacheNeed = `code_${req.mode}_${PROMPT_VERSION}`
  const cached = queryOne<{ result_json: string }>(
    'SELECT result_json FROM ai_explanation_cache WHERE book_id = ? AND selection_hash = ? AND need = ? AND tone = ?',
    [req.bookId, selectionHash, cacheNeed, req.tone]
  )
  if (cached) {
    try {
      const result = JSON.parse(cached.result_json) as CodeExplanationResult
      track(normalizedReq, 'ai_code_explanation_cache_hit', { mode: req.mode, lineCount })
      return { ...result, fromCache: true }
    } catch { /* regenerate a corrupt cache row */ }
  }

  const config = await getTextConfig()
  if (!config.apiKey) throw new Error('应用未配置内置文本模型凭据')
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, dangerouslyAllowBrowser: true })
  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: '你是 Specula 的高级代码阅读向导。只返回符合协议的 JSON，并严格保持源代码行号。' },
      { role: 'user', content: buildPrompt(normalizedReq) },
    ],
    temperature: req.mode === 'dry_run' ? 0.2 : 0.3,
    max_tokens: req.mode === 'dry_run' ? 2400 : 1900,
  })
  const raw = response.choices[0]?.message?.content || ''
  const result = normalizeResult(raw, req.mode, lineCount)
  runSql(
    `INSERT OR REPLACE INTO ai_explanation_cache
     (id, book_id, selection_hash, need, tone, result_json) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), req.bookId, selectionHash, cacheNeed, req.tone, JSON.stringify(result)]
  )
  track(normalizedReq, 'ai_code_explanation_generated', {
    mode: req.mode,
    lineCount,
    fallback: result.fallback,
    tokens: response.usage?.total_tokens || null,
  })
  return result
}
