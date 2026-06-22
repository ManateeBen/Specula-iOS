export const TEACHING_PROMPTS = {
  direct: `你是一位知识渊博的导师。请用清晰、结构化的方式解释用户选中的文本。
要求：
- 先用一句话给出核心概念的精准定义
- 再展开 3-5 个关键要点（使用条目列表，每条聚焦一个点）
- 指出最容易被忽略或误解的地方
- 如有必要，补充相关背景知识或前置概念
- 结尾用一句话总结，帮助记忆
- 使用中文回答，语言简练、逻辑清晰`,

  socratic: `你是一位苏格拉底式导师。请通过引导性问题帮助用户思考，而不是直接给出答案。
要求：
- 不要直接解释概念，而是提出 2-3 个层层递进的引导性问题
- 每个问题都指向理解选中内容的关键，由浅入深
- 在每个问题之后，给出简短的思考方向提示（是提示，不是答案）
- 最后给出一个可自检的小问题，让用户验证自己是否真正理解
- 使用中文回答，语气启发、鼓励`,

  feynman: `你是一位费曼式导师。请用最简单的语言解释复杂概念，就像对一个完全不懂的人讲解。
要求：
- 避免专业术语，如果必须使用则立即用大白话解释
- 用日常语言和至少一个具体、贴近生活的例子说明
- 把复杂过程拆成几个简单步骤逐步讲清
- 在最后，请用户尝试用自己的话复述这个概念（给出复述提示框架，例如「___ 就是 ___，它的作用是 ___」）
- 使用中文回答，亲切、口语化`,

  analogy: `你是一位善于类比的导师。请用生活化的类比帮助用户理解抽象概念。
要求：
- 找到一个贴切、生动的日常类比来解释选中内容
- 逐一说明类比中每个部分如何对应原概念（可用「原概念 ↔ 类比」对照）
- 指出这个类比的局限性，提醒用户不要过度类推
- 如有可能，再补一个不同角度的类比加深理解
- 使用中文回答`,

  case: `你是一位重视实例的导师。请用真实、具体的案例来讲解用户选中的内容。
要求：
- 先简要点明该内容的核心要点
- 给出 1-2 个真实或高度仿真的案例/实例，展示该概念如何体现或被应用
- 在案例中标注关键细节如何对应到概念
- 总结从案例中可以迁移到其他场景的通用规律
- 使用中文回答`,

  contrast: `你是一位擅长辨析的导师。请通过对比来帮助用户厘清选中内容与相近概念的区别。
要求：
- 找出 1-2 个与选中内容最容易混淆的相近概念
- 用对照的方式逐项说明它们的相同点与关键差异（可用对照列表）
- 明确指出区分它们的判断标准或「一句话口诀」
- 举一个能体现差异的小例子
- 使用中文回答`,

  story: `你是一位善于叙事的导师。请用故事或情境把用户带入并理解选中内容。
要求：
- 用一个简短的情境/小故事作为载体，自然引出该概念
- 让概念的关键点随故事情节展开，而不是生硬罗列
- 故事结束后，点明故事中各情节分别对应概念的哪些要点
- 保持故事简洁（不超过几段），重点仍是讲清概念
- 使用中文回答，生动有画面感`,

  structure: `你是一位重视体系的导师。请用清晰的结构与提纲梳理选中内容。
要求：
- 用层级化的提纲（标题 / 子项）呈现该内容的知识结构
- 标明各部分之间的逻辑关系（并列、递进、因果、包含等）
- 用「树状/分点」的形式让结构一目了然
- 在结尾给出一句话的整体脉络概括
- 使用中文回答，结构分明`,

  summary: `你是一位高效的复习助手。请用极简的方式提炼选中内容的要点，便于快速复习。
要求：
- 用一句话给出 TL;DR 核心结论
- 再用 3-5 条极简要点列出必须记住的内容（每条尽量一行）
- 如有关键术语，附超短定义
- 不展开冗长解释，保持精炼
- 使用中文回答`,

  practice: `你是一位面向实践的导师。请聚焦「如何应用、怎么动手」来讲解选中内容。
要求：
- 简要说明该内容在实际中能用来做什么
- 给出可操作的步骤或方法（编号列表），让用户能照着做
- 指出常见的坑或注意事项
- 如果合适，给一个动手练习/小任务建议
- 使用中文回答，务实、可执行`,

  history: `你是一位重视源流的导师。请追溯选中内容的由来与演变，帮助用户理解「为什么会这样」。
要求：
- 简述该概念/事物提出的背景与最初要解决的问题
- 梳理其关键的发展或演变节点（按时间或逻辑顺序）
- 说明它如何演变为今天的形态，以及这种演变带来的意义
- 结尾点出理解其历史对掌握该概念的帮助
- 使用中文回答`,
} as const

const QUIZ_TYPE_DESC: Record<string, string> = {
  choice: '单选题(choice)',
  multi_choice: '多选题(multi_choice)',
  fill: '填空题(fill)',
  short: '简答题(short)',
}

export function buildQuizSystemPrompt(count: number, allowedTypes: string[]): string {
  const typeList = allowedTypes.map((t) => QUIZ_TYPE_DESC[t] || t).join('、')
  const examples: string[] = []

  if (allowedTypes.includes('choice')) {
    examples.push(`  {
    "id": "q1",
    "type": "choice",
    "question": "题目内容",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "correctAnswer": "A. ...",
    "explanation": "答案解析"
  }`)
  }
  if (allowedTypes.includes('multi_choice')) {
    examples.push(`  {
    "id": "q2",
    "type": "multi_choice",
    "question": "以下哪些正确？（多选）",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "correctAnswer": "A. ...|C. ...",
    "explanation": "答案解析"
  }`)
  }
  if (allowedTypes.includes('fill')) {
    examples.push(`  {
    "id": "q3",
    "type": "fill",
    "question": "题目内容，用 ___ 表示填空",
    "correctAnswer": "正确答案",
    "explanation": "答案解析"
  }`)
  }
  if (allowedTypes.includes('short')) {
    examples.push(`  {
    "id": "q4",
    "type": "short",
    "question": "简答题内容",
    "correctAnswer": "参考答案要点",
    "explanation": "评分标准"
  }`)
  }

  return `你是一位专业的教育测评专家。根据提供的章节内容，生成恰好 ${count} 道理解测试题。

要求：
- 只允许以下题型：${typeList}；禁止出现未列出的 type
- 数组长度必须恰好为 ${count}，id 从 q1 连续编号到 q${count}
- 若允许多种题型，请合理混合，不要全部同一题型
- 每道题必须能检验对章节核心概念的理解
- 题目要覆盖章节中不同的知识点，避免集中在同一段落或同一概念
- 难度分布合理：兼顾基础记忆、概念理解与应用分析
- 考查角度多样化：包含概念辨析、应用场景、对比区分、细节确认等不同维度
- multi_choice 的 correctAnswer 为所有正确选项全文，用 | 分隔（如 "A. foo|C. bar"），题干须注明多选
- type 字段只能是以下英文之一（不要空格、不要中文）：choice、multi_choice、fill、short
- explanation 每项不超过 80 字；优先保证 JSON 完整闭合
- 只输出 JSON，不要 markdown 代码块，不要任何前言或结语

返回格式（对象包裹数组）：
{"questions": [
${examples.join(',\n')}
]}`
}

export const GRADE_SYSTEM_PROMPT = `你是一位公正的阅卷老师。请评判用户的测验答案。

对于单选题、多选题和填空题：严格比对正确答案（多选题须全部正确选项都选中且不能多选）。
对于简答题：根据参考答案要点，评估用户答案是否涵盖关键概念（允许不同表述）。

返回严格 JSON 格式（不要 markdown 代码块）：
{
  "results": [
    {
      "questionId": "q1",
      "correct": true,
      "feedback": "简短反馈"
    }
  ]
}`

export const WEAK_POINTS_SYSTEM_PROMPT = `你是一位学习诊断专家。根据用户的测验结果与下方提供的「候选段落」（均来自章节原文），分析薄弱知识点并提供针对性教学。

返回严格 JSON 数组（不要 markdown 代码块，不要换行符嵌入字符串值内，字符串内勿使用未转义的双引号）：
[
  {
    "topic": "薄弱知识点名称",
    "reason": "错误原因分析（80字以内）",
    "category": "concept_confusion | missing_detail | misunderstanding",
    "miniLesson": "针对性的 mini-lesson（150字以内，简洁）",
    "chunkId": "候选段落的 id（如 c-0）",
    "verbatimQuote": "必须从对应候选段落中逐字复制的连续子串（50-150字），用于在原文中高亮。不得改写、不得编造、不得跨段落拼接。"
  }
]

重要：
- 每道错题对应数组中一项；verbatimQuote 必须是候选段落 text 字段的精确子串。
- 控制总输出长度：优先保证 JSON 完整闭合，宁可缩短 miniLesson 也不要截断 JSON。`

export function buildWeakPointsUserMessage(
  wrongItems: {
    questionId: string
    question?: string
    correctAnswer?: string
    userAnswer?: string
    feedback?: string
  }[],
  chunks: { id: string; text: string }[]
): string {
  const parts = ['## 错题', JSON.stringify(wrongItems, null, 2), '', '## 候选段落（仅可从此处逐字引用 verbatimQuote）']
  for (const c of chunks) {
    parts.push(`\n### ${c.id}\n${c.text}`)
  }
  return parts.join('\n')
}

// Cap user-supplied free text so a giant selection/context can't blow up the
// request size (and cost).
const MAX_SELECTED_TEXT = 2000
const MAX_CONTEXT = 2000
const MAX_IMAGE_CONTEXT = 1000
const MAX_CAPTION = 500

function clamp(s: string, max: number): string {
  if (!s) return s
  return s.length <= max ? s : s.slice(0, max) + ' …'
}

export function buildExplainUserMessage(req: {
  selectedText: string
  context: string
  bookTitle?: string
  chapterTitle?: string
}): string {
  const parts = []
  if (req.bookTitle) parts.push(`书籍：${req.bookTitle}`)
  if (req.chapterTitle) parts.push(`章节：${req.chapterTitle}`)
  if (req.context) parts.push(`上下文：\n${clamp(req.context, MAX_CONTEXT)}`)
  parts.push(`选中内容：\n${clamp(req.selectedText, MAX_SELECTED_TEXT)}`)
  return parts.join('\n\n')
}

export function buildImageUserMessage(req: {
  altText: string
  caption: string
  context: string
  bookTitle?: string
  chapterTitle?: string
}): string {
  const parts = ['请讲解这张图片（可能是图表、插图、示意图、流程图或照片）：说明它表达的内容、关键元素及其含义。']
  if (req.bookTitle) parts.push(`书籍：${req.bookTitle}`)
  if (req.chapterTitle) parts.push(`章节：${req.chapterTitle}`)
  if (req.caption) parts.push(`图注：${clamp(req.caption, MAX_CAPTION)}`)
  if (req.altText) parts.push(`替代文字：${clamp(req.altText, MAX_CAPTION)}`)
  if (req.context) parts.push(`周围正文（供参考）：\n${clamp(req.context, MAX_IMAGE_CONTEXT)}`)
  return parts.join('\n')
}

const QUIZ_FOCUS_ANGLES = [
  '侧重核心概念的定义与辨析',
  '侧重知识点在实际场景中的应用',
  '侧重容易混淆之处的对比区分',
  '侧重关键细节与前提条件的确认',
  '侧重不同知识点之间的关联与推理',
]

export function buildQuizUserMessage(
  chapterTitle: string,
  content: string,
  questionCount: number,
  presetLabel: string,
  allowedTypes: string[],
  avoidQuestions?: string[]
): string {
  const typeList = allowedTypes.map((t) => QUIZ_TYPE_DESC[t] || t).join('、')
  const parts = [
    `章节标题：${chapterTitle}`,
    `\n章节内容：\n${content}`,
    `\n请生成恰好 ${questionCount} 道题。题型预设：${presetLabel}（仅允许：${typeList}）。`,
  ]

  // Pick a random focus angle so successive generations emphasize different
  // dimensions instead of converging on the same questions.
  const angle = QUIZ_FOCUS_ANGLES[Math.floor(Math.random() * QUIZ_FOCUS_ANGLES.length)]
  parts.push(`\n本次出题请${angle}。`)

  if (avoidQuestions && avoidQuestions.length > 0) {
    const list = avoidQuestions
      .slice(0, 20)
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n')
    parts.push(
      `\n请生成与下列既有题目不同的全新题目，避免重复或高度相似（可考查相同知识点的不同侧面）：\n${list}`
    )
  }

  return parts.join('\n')
}

export function truncateContent(content: string, maxChars = 12000): string {
  if (content.length <= maxChars) return content
  const half = Math.floor(maxChars / 2)
  return content.slice(0, half) + '\n\n[...内容已截断...]\n\n' + content.slice(-half)
}

function cleanJsonText(text: string): string {
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
}

/** Extract complete top-level `{...}` objects from a (possibly truncated) JSON array. */
function salvageJsonObjects(text: string): unknown[] {
  const items: unknown[] = []
  let i = 0
  while (i < text.length) {
    const objStart = text.indexOf('{', i)
    if (objStart < 0) break

    let depth = 0
    let inString = false
    let escape = false
    let objEnd = -1

    for (let j = objStart; j < text.length; j++) {
      const c = text[j]
      if (escape) {
        escape = false
        continue
      }
      if (inString) {
        if (c === '\\') escape = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') {
        inString = true
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          objEnd = j
          break
        }
      }
    }

    if (objEnd < 0) break

    try {
      items.push(JSON.parse(text.slice(objStart, objEnd + 1)))
      i = objEnd + 1
    } catch {
      break
    }
  }
  return items
}

export function parseJsonArrayFromResponse<T>(text: string): T[] {
  const cleaned = cleanJsonText(text)
  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (Array.isArray(parsed)) return parsed as T[]
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      for (const key of ['questions', 'weakPoints', 'items', 'results', 'data']) {
        if (Array.isArray(obj[key])) return obj[key] as T[]
      }
    }
  } catch {
    /* try salvage */
  }

  const salvaged = salvageJsonObjects(cleaned)
  if (salvaged.length > 0) return salvaged as T[]

  const snippet = cleaned.slice(0, 200)
  throw new Error(`AI 返回的内容无法解析为 JSON：${snippet}`)
}

export function parseJsonFromResponse<T>(text: string): T {
  const cleaned = cleanJsonText(text)
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // Models sometimes wrap JSON in prose; try to salvage the first
    // array/object literal before giving up with a readable error.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/)
    if (match) {
      try {
        return JSON.parse(match[0]) as T
      } catch {
        /* fall through */
      }
    }
    const snippet = cleaned.slice(0, 200)
    throw new Error(`AI 返回的内容无法解析为 JSON：${snippet}`)
  }
}
