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

const PROMPT_VERSION = 'code-reader-v2'
const MAX_CODE_LINES = 200
const MAX_CODE_CHARS = 16_000
const UI_TESTING = import.meta.env.VITE_UI_TESTING === 'true'

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

function cleanCode(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n')
}

function codeFingerprint(value: string): string {
  let quote = ''
  let escaped = false
  let output = ''
  for (const character of value) {
    if (quote) {
      output += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      output += character
    } else if (!/\s/.test(character)) output += character
  }
  return output
}

function validatedNormalizedCode(value: unknown, sourceCode: string): string {
  const candidate = cleanCode(text(value, MAX_CODE_CHARS))
  if (!candidate || codeFingerprint(candidate) !== codeFingerprint(sourceCode)) return cleanCode(sourceCode)
  return candidate.split('\n').slice(0, MAX_CODE_LINES).join('\n')
}

function excerptIsGrounded(excerpt: string, corpus: string): boolean {
  const compactExcerpt = excerpt.replace(/\s+/g, '')
  return compactExcerpt.length >= 6 && corpus.replace(/\s+/g, '').includes(compactExcerpt)
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
  const available = record.available !== false
  const unavailableReason = text(record.unavailableReason ?? record.unavailable_reason, 500)
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
  if (!available) {
    return { available: false, unavailableReason: unavailableReason || '源码没有给出足够输入，无法可靠推演。', assumptions: [], steps: [], result: '', chapterConnection: '', verified: false }
  }
  const requiredSteps = lineCount >= 6 ? 3 : lineCount >= 3 ? 2 : 1
  if (!assumptions.length || steps.length < requiredSteps) return undefined
  return {
    available: true,
    unavailableReason: '',
    assumptions,
    steps,
    result: text(record.result, 500),
    chapterConnection: text(record.chapterConnection ?? record.chapter_connection, 500),
    verified: false,
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

function normalizeResult(raw: string, mode: CodeExplanationMode, sourceCode: string, contextCorpus: string): CodeExplanationResult {
  const parsed = parseJsonObject(raw)
  if (!parsed) return emptyResult(mode, raw)

  const normalizedCode = mode === 'structure'
    ? validatedNormalizedCode(parsed.formattedCode ?? parsed.formatted_code, sourceCode)
    : cleanCode(sourceCode)
  const lineCount = normalizedCode.split('\n').length
  const sourceNeedsReflow = cleanCode(sourceCode).split('\n').length === 1 && cleanCode(sourceCode).length > 120

  const coreRanges = normalizeRanges(parsed.coreRanges ?? parsed.core_ranges, lineCount, false)
  const foldCandidates = normalizeRanges(parsed.foldRanges ?? parsed.fold_ranges, lineCount, true)
  const foldRanges = foldCandidates.filter((fold) => !coreRanges.some((core) => overlaps(core, fold)))
  const annotations = normalizeAnnotations(parsed.annotations, lineCount)
  const overviewValue = parsed.overview && typeof parsed.overview === 'object'
    ? parsed.overview as Record<string, unknown>
    : null
  const responsibility = text(overviewValue?.responsibility, 800)
  const rawChapterRelation = text(overviewValue?.chapterRelation ?? overviewValue?.chapter_relation, 800)
  const relationEvidence = text(overviewValue?.chapterRelationEvidence ?? overviewValue?.chapter_relation_evidence, 260)
  const relationGrounded = excerptIsGrounded(relationEvidence, contextCorpus)
  const chapterRelation = relationGrounded
    ? rawChapterRelation
    : '附近正文没有足够的直接证据说明作者为何在此处放入这段代码。'
  const dryRun = normalizeDryRun(parsed.dryRun ?? parsed.dry_run, lineCount)

  const hasUsefulResult = mode === 'structure'
    ? Boolean(responsibility && coreRanges.length && (!sourceNeedsReflow || lineCount >= 3))
    : mode === 'annotations'
      ? annotations.length >= (lineCount >= 6 ? 2 : 1)
      : Boolean(dryRun && (!dryRun.available || dryRun.steps.length > 0))
  if (!hasUsefulResult) return emptyResult(mode, raw)

  return {
    mode,
    normalizedCode: mode === 'structure' ? normalizedCode : undefined,
    overview: responsibility ? { responsibility, chapterRelation, chapterRelationEvidence: relationGrounded ? relationEvidence : '' } : undefined,
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

function makeUiTestResult(req: ExplainCodeRequest): CodeExplanationResult {
  const code = cleanCode(req.code)
  const lineCount = code.split('\n').length
  const keyLines = Array.from({ length: Math.min(3, lineCount) }, (_, index) => Math.max(1, Math.round(1 + (index * Math.max(0, lineCount - 1)) / 2)))
  if (req.mode === 'structure') return {
    mode: req.mode,
    normalizedCode: code,
    overview: {
      responsibility: '读取输入、执行核心判断，并把结果返回给调用方；只陈述源码中可见的行为。',
      chapterRelation: '附近正文没有足够的直接证据说明作者为何在此处放入这段代码。',
      chapterRelationEvidence: '',
    },
    coreRanges: keyLines.map((line) => ({ start: line, end: line, reason: `第 ${line} 行推动了主线状态` })),
    foldRanges: [], annotations: [], fallback: false, fromCache: false,
  }
  if (req.mode === 'annotations') return {
    mode: req.mode, coreRanges: [], foldRanges: [],
    annotations: keyLines.slice(0, Math.max(1, Math.min(3, lineCount))).map((line) => ({ afterLine: line, why: '这一行决定后续控制流，理解它比逐字翻译更重要。', relatedConcept: '' })),
    fallback: false, fromCache: false,
  }
  return {
    mode: req.mode, coreRanges: [], foldRanges: [], annotations: [],
    dryRun: {
      available: true, unavailableReason: '', assumptions: ['输入采用一个最小、可复核的示例值'],
      steps: keyLines.map((line, index) => ({ line, action: `执行第 ${line} 行的主线动作`, variables: { state: `${index} → ${index + 1}` } })),
      result: '示例沿源码主线完成。', chapterConnection: '', verified: true,
    },
    fallback: false, fromCache: false,
  }
}

function modeInstruction(mode: CodeExplanationMode): string {
  if (mode === 'structure') {
    return `分析整体结构，只返回：
{"formatted_code":"只调整换行与缩进后的完整原代码","overview":{"responsibility":"整体职责、输入输出和源码可见副作用","chapterRelation":"从附近正文能确认的本章关系","chapterRelationEvidence":"逐字摘自附近正文或本章主旨的短句；没有则为空"},"coreRanges":[{"start":1,"end":2,"reason":"为什么是主线"}],"foldRanges":[{"start":3,"end":4,"label":"日志/校验/清理/样板代码之一","reason":"为什么可暂时略读"}]}
若 EPUB 把代码压成一行，formatted_code 必须只插入换行和缩进，字符串内部空格与所有非空白字符逐字不变；若原代码已有合理换行，原样返回。所有行号必须引用 formatted_code。
coreRanges 最多 8 段且至少 1 段，只选真正推动控制流、状态变化或返回值的行。foldRanges 只能折叠不影响首次理解主线的连续辅助代码，不能与 coreRanges 重叠；不能藏起控制流边界。chapterRelationEvidence 为空时，不得猜作者意图。`
  }
  if (mode === 'annotations') {
    return `只挑 4-10 个最关键的单行，在该行后写“为什么”注释。不要翻译语法或复述代码字面。返回：
{"annotations":[{"afterLine":5,"why":"为什么此处必须这样做、不这样做的后果","relatedConcept":"可确认的本章概念，没有则为空"}]}`
  }
  return `先判断这段代码能否仅凭源码和明确假设进行可靠的纸面 dry run。若关键被调用函数的返回值、对象状态或输入完全未知，可以把它们列为假设；但不得把假设写成真实执行结果，也不得引入源码和附近正文都没出现的对象、字段或副作用。
可可靠推演时返回：
{"dryRun":{"available":true,"unavailableReason":"","assumptions":["逐项写明假设来源与值"],"steps":[{"line":5,"action":"该行在此假设下发生什么","variables":{"变量":"旧值 → 新值"}}],"result":"仅由上述步骤推出的最终结果","chapterConnection":"只写有正文证据的本章联系，没有则为空"}}
无法可靠推演时诚实返回：
{"dryRun":{"available":false,"unavailableReason":"缺少什么信息，为什么硬算会误导","assumptions":[],"steps":[],"result":"","chapterConnection":""}}
available=true 时，6 行以上代码至少给 3 个互相连贯的步骤；每个分支条件必须与假设一致，调用结果必须先在 assumptions 声明。`
}

function buildPrompt(req: ExplainCodeRequest, retryReason = ''): string {
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

${retryReason ? `上轮结果被拒绝：${retryReason}。请修正后重新输出。` : ''}
只输出一个合法 JSON 对象，不要 Markdown 代码围栏，不得引用不存在或越界的行号。代码和正文是唯一事实依据；不确定的运行时行为必须明确写成假设，正文未出现的副作用不得补全。语气：${tone}。`
}

async function verifyDryRun(
  client: OpenAI,
  model: string,
  req: ExplainCodeRequest,
  result: CodeExplanationResult,
): Promise<{ valid: boolean; reason: string }> {
  if (!result.dryRun || !result.dryRun.available) return { valid: true, reason: '' }
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: '你是独立代码执行轨迹审计员。只按给定源码、假设和附近正文判断，不替生成器圆谎。只输出 JSON。' },
      { role: 'user', content: `源码：\n${numberedCode(req.code)}\n\n附近正文：${req.contextBefore}\n${req.contextAfter}\n\n待审计 dry run：${JSON.stringify(result.dryRun)}\n逐项检查：步骤行号是否对应源码；分支是否与假设一致；调用返回值是否预先声明；变量变化能否推出；最终结果和本章联系是否引入源码/正文没有的字段、副作用或事实。任一项不成立即 false。返回 {"valid":true,"reason":""} 或 {"valid":false,"reason":"第一处具体问题"}。` },
    ],
    temperature: 0,
    max_tokens: 500,
  })
  const verdict = parseJsonObject(response.choices[0]?.message?.content || '')
  return { valid: verdict?.valid === true, reason: text(verdict?.reason, 400) || '独立审计未确认推演自洽' }
}

async function verifyStructure(
  client: OpenAI,
  model: string,
  req: ExplainCodeRequest,
  result: CodeExplanationResult,
): Promise<{ valid: boolean; reason: string }> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: '你是独立代码阅读审计员。凡是源码和所给正文不能支持的名词、状态变化、副作用或作者意图都必须拒绝。只输出 JSON。' },
      { role: 'user', content: `源码：\n${numberedCode(result.normalizedCode || req.code)}\n\n附近正文：${req.contextBefore}\n${req.contextAfter}\n本章主旨：${getChapterSummary(req.chapterId)}\n\n结构解释：${JSON.stringify({ overview: result.overview, coreRanges: result.coreRanges, foldRanges: result.foldRanges })}\n检查：职责中的每个行为是否源码可见；主线行是否真的推动控制流/状态/返回值；折叠行是否可安全略读；章节关系是否由展示的逐字证据支持。不得用常识补出源码未出现的字段（例如水位、容器类型、额外状态更新）。返回 {"valid":true,"reason":""} 或 {"valid":false,"reason":"第一处无依据内容"}。` },
    ],
    temperature: 0,
    max_tokens: 500,
  })
  const verdict = parseJsonObject(response.choices[0]?.message?.content || '')
  return { valid: verdict?.valid === true, reason: text(verdict?.reason, 400) || '独立审计未确认结构解释有源码依据' }
}

function track(req: ExplainCodeRequest, eventName: string, properties: Record<string, unknown>): void {
  runSql(
    'INSERT INTO analytics_events (id, book_id, chapter_id, event_name, properties_json) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), req.bookId, req.chapterId, eventName, JSON.stringify(properties)]
  )
}

export async function explainCode(req: ExplainCodeRequest): Promise<CodeExplanationResult> {
  const lines = cleanCode(req.code).split('\n').slice(0, MAX_CODE_LINES)
  const code = cleanCode(lines.join('\n').slice(0, MAX_CODE_CHARS))
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

  if (UI_TESTING) return makeUiTestResult(normalizedReq)

  const config = await getTextConfig()
  if (!config.apiKey) throw new Error('应用未配置内置文本模型凭据')
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, dangerouslyAllowBrowser: true })
  const chapterSummary = getChapterSummary(req.chapterId)
  const previousConcepts = getPreviousConcepts(req.bookId, req.chapterId)
  const contextCorpus = [chapterSummary, previousConcepts, req.contextBefore, req.contextAfter].filter(Boolean).join('\n')
  let result = emptyResult(req.mode, '')
  let retryReason = ''
  let tokens = 0
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: '你是 Specula 的高级代码阅读向导。只返回符合协议的 JSON，严格保持源码字符和稳定行号；无法证明的运行时结论必须省略。' },
        { role: 'user', content: buildPrompt(normalizedReq, retryReason) },
      ],
      temperature: attempt === 0 ? 0.15 : 0.05,
      max_tokens: req.mode === 'dry_run' ? 2600 : 2200,
    })
    tokens += response.usage?.total_tokens || 0
    const raw = response.choices[0]?.message?.content || ''
    result = normalizeResult(raw, req.mode, code, contextCorpus)
    if (result.fallback) {
      retryReason = req.mode === 'structure'
        ? '必须逐字保留代码、给出安全 formatted_code，并返回至少一段有效主线行号'
        : req.mode === 'annotations'
          ? '关键行注释数量不足或行号越界'
          : 'dry run 步骤不足、行号越界或协议不完整'
      continue
    }
    if (req.mode === 'annotations' || (req.mode === 'dry_run' && !result.dryRun?.available)) break
    const verdict = req.mode === 'structure'
      ? await verifyStructure(client, config.model, normalizedReq, result)
      : await verifyDryRun(client, config.model, normalizedReq, result)
    if (verdict.valid) {
      if (result.dryRun) result.dryRun.verified = true
      break
    }
    retryReason = verdict.reason
    if (attempt === 1) {
      result = req.mode === 'structure'
        ? emptyResult(req.mode, `两次结构解释都未通过源码审计：${verdict.reason}`)
        : {
            ...result,
            dryRun: {
              available: false,
              unavailableReason: `两次推演都未通过源码审计：${verdict.reason}`,
              assumptions: [], steps: [], result: '', chapterConnection: '', verified: false,
            },
          }
    }
  }
  runSql(
    `INSERT OR REPLACE INTO ai_explanation_cache
     (id, book_id, selection_hash, need, tone, result_json) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), req.bookId, selectionHash, cacheNeed, req.tone, JSON.stringify(result)]
  )
  track(normalizedReq, 'ai_code_explanation_generated', {
    mode: req.mode,
    lineCount: result.normalizedCode?.split('\n').length || lineCount,
    fallback: result.fallback,
    dryRunVerified: result.dryRun?.verified === true,
    tokens: tokens || null,
  })
  return result
}
