import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import type {
  ExplainFormulaRequest,
  FormulaExplanationResult,
  FormulaPipelineStep,
  FormulaSymbol,
  FormulaTinyRunStep,
} from '../types'
import { queryOne, runSql } from './db'
import { getTextConfig } from './settings.service'

const PROMPT_VERSION = 'formula-reader-v1'
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
    try { return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown> } catch { return null }
  }
}

function text(value: unknown, max = 600): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : []
}

function normalizeResult(raw: string): FormulaExplanationResult {
  const parsed = parseJsonObject(raw)
  if (!parsed) return {
    symbols: [], pipelineSteps: [], rationale: [], mnemonic: '', fallback: true, fromCache: false,
    fallbackText: raw.trim().slice(0, 2400) || '公式解读暂时不可用，请稍后重试。',
  }
  const symbols: FormulaSymbol[] = list(parsed.symbols).map((item) => ({
    token: text(item.token, 40),
    meaning: text(item.meaning, 320),
    dimension: text(item.dimension ?? item.shape, 100) || '标量或原文未说明',
    definedAt: text(item.definedAt ?? item.defined_at, 120),
    previousOccurrence: text(item.previousOccurrence ?? item.previous_occurrence, 120),
  })).filter((item) => item.token && item.meaning).slice(0, 16)
  const pipelineSteps: FormulaPipelineStep[] = list(parsed.pipelineSteps ?? parsed.pipeline_steps).map((item) => ({
    expression: text(item.expression, 180),
    explanation: text(item.explanation, 420),
    inputShape: text(item.inputShape ?? item.input_shape, 120),
    outputShape: text(item.outputShape ?? item.output_shape, 120),
  })).filter((item) => item.expression && item.explanation).slice(0, 10)
  const rationale = list(parsed.rationale).map((item) => ({
    part: text(item.part, 100),
    purpose: text(item.purpose, 420),
    counterfactual: text(item.counterfactual, 420),
  })).filter((item) => item.part && item.purpose && item.counterfactual).slice(0, 10)
  const tiny = parsed.tinyRun ?? parsed.tiny_run
  let tinyRun: FormulaExplanationResult['tinyRun']
  if (tiny && typeof tiny === 'object') {
    const record = tiny as Record<string, unknown>
    const assumptions = Array.isArray(record.assumptions)
      ? record.assumptions.map((item) => text(item, 180)).filter(Boolean).slice(0, 8)
      : []
    const steps: FormulaTinyRunStep[] = list(record.steps).map((item) => ({
      expression: text(item.expression, 180),
      calculation: text(item.calculation, 320),
      result: text(item.result, 180),
    })).filter((item) => item.expression && item.calculation && item.result).slice(0, 12)
    if (assumptions.length && steps.length) {
      tinyRun = { assumptions, steps, conclusion: text(record.conclusion, 500), verified: false }
    }
  }
  const useful = symbols.length > 0 && pipelineSteps.length > 0 && rationale.length > 0
  return {
    symbols, pipelineSteps, tinyRun, rationale, mnemonic: text(parsed.mnemonic, 100),
    fallback: !useful, fromCache: false,
    fallbackText: useful ? undefined : '模型返回的公式结构不完整，请重试。',
  }
}

function uiTestResult(): FormulaExplanationResult {
  return {
    symbols: [
      { token: 'Q', meaning: '查询向量：当前 token 正在寻找什么', dimension: 'n×dₖ', definedAt: '当前公式', previousOccurrence: '本章前文' },
      { token: 'K', meaning: '键向量：每个 token 可被怎样匹配', dimension: 'n×dₖ', definedAt: '当前公式', previousOccurrence: '本章前文' },
      { token: 'V', meaning: '值向量：匹配后真正取走的信息', dimension: 'n×dᵥ', definedAt: '当前公式', previousOccurrence: '本章前文' },
      { token: 'dₖ', meaning: '键向量的维度，用于缩放点积', dimension: '标量', definedAt: '当前公式', previousOccurrence: '首次出现' },
    ],
    pipelineSteps: [
      { expression: 'QKᵀ', explanation: '计算每个查询与所有键的相似度。', inputShape: 'n×dₖ · dₖ×n', outputShape: 'n×n' },
      { expression: 'QKᵀ / √dₖ', explanation: '缩放分数，避免维度变大时 softmax 过早饱和。', inputShape: 'n×n', outputShape: 'n×n' },
      { expression: 'softmax(·)V', explanation: '把分数变成权重，再按权重汇总信息。', inputShape: 'n×n · n×dᵥ', outputShape: 'n×dᵥ' },
    ],
    tinyRun: {
      assumptions: ['QKᵀ = [8, 2]', 'dₖ = 4'],
      steps: [
        { expression: '[8,2] / √4', calculation: '[8,2] / 2', result: '[4,1]' },
        { expression: 'softmax([4,1])', calculation: '[e⁴,e¹] / (e⁴+e¹)', result: '约 [0.95,0.05]' },
      ],
      conclusion: '第一个 token 获得绝大多数注意力。', verified: true,
    },
    rationale: [
      { part: '÷√dₖ', purpose: '让不同维度下的分数尺度保持可控。', counterfactual: '去掉后，高维点积更大，softmax 更容易饱和。' },
      { part: 'softmax', purpose: '把任意分数转成总和为 1 的可比较权重。', counterfactual: '去掉后，权重不再归一，输出尺度会随分数漂移。' },
    ],
    mnemonic: '问 → 比 → 缩放 → 分权 → 取值', fallback: false, fromCache: false,
  }
}

function buildPrompt(req: ExplainFormulaRequest, retryReason = ''): string {
  return `你是 Specula 的数学公式阅读向导。请把公式解释成工程师可以校验的结构化数据。
书名：${req.bookTitle || '未知'}；章节：${req.chapterTitle || '未知'}
格式：${req.format}；公式源码：${req.source}
显示文本：${req.displayText}
前文：${req.contextBefore || '无'}
后文：${req.contextAfter || '无'}

规则：
1. symbols 列出公式中真正出现的每个关键符号；meaning 说明身份，dimension/shape 是一等信息。原文没给形状时明确写“原文未说明”，不得编造。
2. pipeline_steps 按实际运算顺序从内到外拆解，每步同时给表达式、白话目的、输入形状和输出形状。
3. tiny_run 使用 1-2 个元素或 2×2 以内小整数，逐步写出可心算的中间值；所有数值必须自洽。
4. rationale 解释每个关键部件为何存在，并给出删掉或替换它会怎样的反事实；没有依据时明确限定为一般数学后果。
5. previous_occurrence 只能根据给出的上下文判断，不知道就写“未确认”。
6. 不要用公式自身去证明公式，不得虚构作者意图。
${retryReason ? `上次复算失败：${retryReason}。请修正 tiny_run。` : ''}
只输出 JSON：{"symbols":[{"token":"Q","meaning":"...","dimension":"n×d","defined_at":"...","previous_occurrence":"..."}],"pipeline_steps":[{"expression":"...","explanation":"...","input_shape":"...","output_shape":"..."}],"tiny_run":{"assumptions":["..."],"steps":[{"expression":"...","calculation":"...","result":"..."}],"conclusion":"..."},"rationale":[{"part":"...","purpose":"...","counterfactual":"..."}],"mnemonic":"..."}`
}

async function verifyTinyRun(client: OpenAI, model: string, req: ExplainFormulaRequest, result: FormulaExplanationResult): Promise<{ valid: boolean; reason: string }> {
  if (!result.tinyRun) return { valid: false, reason: '缺少数值推演' }
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: '你是独立数学验算员。逐步重算，不接受仅凭叙述判断。只返回 JSON。' },
      { role: 'user', content: `公式：${req.displayText || req.source}\n推演：${JSON.stringify(result.tinyRun)}\n检查每一步算术、维度与最终结论是否自洽。返回 {"valid":true,"reason":""}；任一处不可靠则 valid=false 并指出第一处错误。` },
    ], temperature: 0, max_tokens: 500,
  })
  const judged = parseJsonObject(response.choices[0]?.message?.content || '')
  return { valid: judged?.valid === true, reason: text(judged?.reason, 300) }
}

function track(req: ExplainFormulaRequest, eventName: string, properties: Record<string, unknown>): void {
  runSql('INSERT INTO analytics_events (id, book_id, chapter_id, event_name, properties_json) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), req.bookId, req.chapterId, eventName, JSON.stringify(properties)])
}

export async function explainFormula(req: ExplainFormulaRequest): Promise<FormulaExplanationResult> {
  const source = req.source.trim().slice(0, 8000)
  if (!source) throw new Error('公式为空，无法解读')
  const identity = [PROMPT_VERSION, source, req.contextBefore, req.contextAfter, req.chapterTitle].join('\n')
  const selectionHash = hashText(identity)
  const cacheNeed = `formula_${PROMPT_VERSION}`
  const cached = queryOne<{ result_json: string }>('SELECT result_json FROM ai_explanation_cache WHERE book_id = ? AND selection_hash = ? AND need = ? AND tone = ?',
    [req.bookId, selectionHash, cacheNeed, req.tone])
  if (cached) {
    try {
      const result = JSON.parse(cached.result_json) as FormulaExplanationResult
      track(req, 'ai_formula_explanation_cache_hit', { format: req.format })
      return { ...result, fromCache: true }
    } catch { /* regenerate corrupt cache */ }
  }
  if (UI_TESTING) return uiTestResult()

  const config = await getTextConfig()
  if (!config.apiKey) throw new Error('应用未配置内置文本模型凭据')
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, dangerouslyAllowBrowser: true })
  let result: FormulaExplanationResult | null = null
  let retryReason = ''
  let tokens = 0
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: '只输出符合协议的 JSON。公式和上下文是唯一事实来源，数值推演必须可复算。' },
        { role: 'user', content: buildPrompt({ ...req, source }, retryReason) },
      ], temperature: attempt === 0 ? 0.2 : 0.1, max_tokens: 3200,
    })
    tokens += response.usage?.total_tokens || 0
    result = normalizeResult(response.choices[0]?.message?.content || '')
    if (result.fallback) break
    const verdict = await verifyTinyRun(client, config.model, req, result)
    if (verdict.valid && result.tinyRun) {
      result.tinyRun.verified = true
      break
    }
    retryReason = verdict.reason || '数值推演未通过独立复算'
    if (attempt === 1) result.tinyRun = undefined
  }
  const finalResult = result || normalizeResult('')
  runSql(`INSERT OR REPLACE INTO ai_explanation_cache (id, book_id, selection_hash, need, tone, result_json) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuidv4(), req.bookId, selectionHash, cacheNeed, req.tone, JSON.stringify(finalResult)])
  track(req, 'ai_formula_explanation_generated', { format: req.format, tinyRunVerified: finalResult.tinyRun?.verified === true, tokens })
  return finalResult
}
