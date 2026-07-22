export type BookFormat = 'epub' | 'pdf'
export type PdfTextStatus = 'text' | 'scan' | 'mixed' | 'unknown'

export type TeachingMode =
  | 'direct'
  | 'socratic'
  | 'feynman'
  | 'analogy'
  | 'case'
  | 'contrast'
  | 'story'
  | 'structure'
  | 'summary'
  | 'practice'
  | 'history'

export type ExplanationNeed =
  | 'not_understood'
  | 'clarify'
  | 'memorize'
  | 'why_design'
  | 'apply'

export type ExplanationTone = 'rigorous' | 'casual'

export interface ExplanationSection {
  label: string
  text: string
}

export type ExplanationTail =
  | {
      type: 'check'
      question: string
      answer: boolean
      feedbackRight: string
      feedbackWrong: string
    }
  | { type: 'deeper'; question: string }
  | { type: 'flashcard'; front: string; back: string }
  | { type: 'pattern'; question: string }
  | { type: 'action'; task: string }
  | { type: 'none' }

export interface StructuredExplanation {
  sections: ExplanationSection[]
  tail: ExplanationTail
  fallback: boolean
  fromCache: boolean
}

export interface ExplainNeedRequest {
  bookId: string
  chapterId: string | null
  selectedText: string
  contextBefore: string
  need: ExplanationNeed
  tone: ExplanationTone
  bookTitle?: string
  chapterTitle?: string
  followUp?: string
}

export interface ImageExplainNeedRequest {
  bookId: string
  chapterId: string | null
  imageDataUrl: string
  altText: string
  caption: string
  context: string
  need: ExplanationNeed
  tone: ExplanationTone
  bookTitle?: string
  chapterTitle?: string
  followUp?: string
}

export interface InferredExplanationNeed {
  need: ExplanationNeed
  reason: string
}

export type CodeExplanationMode = 'structure' | 'annotations' | 'dry_run'

export interface CodeSelectionInfo {
  code: string
  language: string
  contextBefore: string
  contextAfter: string
  originalLineCount: number
  truncated: boolean
}

export interface CodeLineRange {
  start: number
  end: number
  reason: string
  label?: string
}

export interface CodeLineAnnotation {
  afterLine: number
  why: string
  relatedConcept: string
}

export interface CodeDryRunStep {
  line: number
  action: string
  variables: Record<string, string>
}

export interface CodeExplanationResult {
  mode: CodeExplanationMode
  normalizedCode?: string
  overview?: {
    responsibility: string
    chapterRelation: string
    chapterRelationEvidence: string
  }
  coreRanges: CodeLineRange[]
  foldRanges: CodeLineRange[]
  annotations: CodeLineAnnotation[]
  dryRun?: {
    available: boolean
    unavailableReason: string
    assumptions: string[]
    steps: CodeDryRunStep[]
    result: string
    chapterConnection: string
    verified: boolean
  }
  fallbackText?: string
  fallback: boolean
  fromCache: boolean
}

export interface ExplainCodeRequest {
  bookId: string
  chapterId: string | null
  code: string
  language: string
  contextBefore: string
  contextAfter: string
  mode: CodeExplanationMode
  tone: ExplanationTone
  bookTitle?: string
  chapterTitle?: string
}

export type FormulaSourceFormat = 'mathml' | 'latex' | 'plain'
export type FormulaExplanationMode = 'symbols' | 'pipeline' | 'tiny_run' | 'rationale'

export interface FormulaSelectionInfo {
  source: string
  displayText: string
  format: FormulaSourceFormat
  contextBefore: string
  contextAfter: string
}

export interface FormulaSymbol {
  token: string
  meaning: string
  dimension: string
  definedAt: string
  previousOccurrence: string
}

export interface FormulaPipelineStep {
  expression: string
  explanation: string
  inputShape: string
  outputShape: string
}

export interface FormulaTinyRunStep {
  expression: string
  calculation: string
  result: string
}

export interface FormulaExplanationResult {
  symbols: FormulaSymbol[]
  pipelineSteps: FormulaPipelineStep[]
  tinyRun?: {
    assumptions: string[]
    steps: FormulaTinyRunStep[]
    conclusion: string
    verified: boolean
  }
  rationale: {
    part: string
    purpose: string
    counterfactual: string
  }[]
  mnemonic: string
  fallbackText?: string
  fallback: boolean
  fromCache: boolean
}

export interface ExplainFormulaRequest {
  bookId: string
  chapterId: string | null
  source: string
  displayText: string
  format: FormulaSourceFormat
  contextBefore: string
  contextAfter: string
  tone: ExplanationTone
  bookTitle?: string
  chapterTitle?: string
}

export interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  filePath: string
  coverPath: string | null
  pdfTextStatus: PdfTextStatus | null
  pdfAiUnsupportedReason: string | null
  createdAt: string
}

export interface Chapter {
  id: string
  bookId: string
  title: string
  orderIndex: number
  startRef: string
  endRef: string
}

export type QuickBrowseStatus = 'unanswered' | 'confident' | 'gap' | 'repaired'

export interface ChapterDigest {
  id: string
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  cardIndex: number
  title: string
  summary: string
  keyTerms: string[]
  question: string
  answerAnchor: string
  evidenceText: string
  expectedAnswer: string
  qualityVersion: number
  status: QuickBrowseStatus
  answeredAt: string | null
  updatedAt: string
}

export interface QuickBrowseProgress {
  bookId: string
  digests: ChapterDigest[]
  generationComplete: boolean
  generatedCount: number
  eligibleChapterCount: number
}

export interface ReadingProgress {
  bookId: string
  chapterId: string | null
  position: string
  updatedAt: string
}

export interface Highlight {
  id: string
  bookId: string
  chapterId: string | null
  selectedText: string
  context: string
  aiExplanation: string | null
  teachingMode: TeachingMode | null
  source: 'user' | 'quiz'
  weakPointTopic: string | null
  weakPointIndex: number | null
  createdAt: string
}

export type QuestionType = 'choice' | 'multi_choice' | 'fill' | 'short'

export type QuizPreset =
  | 'choice_only'
  | 'choice_multi'
  | 'choice_fill'
  | 'choice_short'
  | 'all'

export const QUIZ_PRESET_LABELS: Record<QuizPreset, string> = {
  choice_only: '仅单选题',
  choice_multi: '单选 + 多选',
  choice_fill: '选择题 + 填空题',
  choice_short: '选择题 + 简答题',
  all: '全部题型',
}

export const QUIZ_PRESET_TYPES: Record<QuizPreset, QuestionType[]> = {
  choice_only: ['choice'],
  choice_multi: ['choice', 'multi_choice'],
  choice_fill: ['choice', 'fill'],
  choice_short: ['choice', 'short'],
  all: ['choice', 'multi_choice', 'fill', 'short'],
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  choice: '单选题',
  multi_choice: '多选题',
  fill: '填空题',
  short: '简答题',
}

export interface QuizQuestion {
  id: string
  type: QuestionType
  question: string
  options?: string[]
  correctAnswer: string
  explanation: string
}

export interface Quiz {
  id: string
  chapterId: string
  questions: QuizQuestion[]
  createdAt: string
}

export interface QuizAnswer {
  questionId: string
  answer: string
}

export interface WeakPoint {
  topic: string
  reason: string
  category: 'concept_confusion' | 'missing_detail' | 'misunderstanding'
  miniLesson: string
  sourceExcerpt: string
  anchorChunkId?: string
  anchorQuote?: string
}

export interface QuizAttempt {
  id: string
  quizId: string
  answers: QuizAnswer[]
  score: number
  weakPoints: WeakPoint[]
  results: { questionId: string; correct: boolean; feedback: string }[]
  timeTakenMs: number
  completedAt: string
  createdAt: string
}

export interface AppSettings {
  apiKey: string
  baseURL: string
  model: string
  defaultTeachingMode: TeachingMode
  explanationTone: ExplanationTone
  darkMode: boolean
  readingMode: ReadingMode
  // Vision model (for explaining images) — DeepSeek's API is text-only, so a
  // separate OpenAI-compatible vision endpoint is used (e.g. Aliyun DashScope / Qwen-VL).
  visionApiKey: string
  visionBaseURL: string
  visionModel: string
}

export interface ImageSelectionInfo {
  imageDataUrl: string
  imageAltText: string
  imageCaption: string
  imageContext: string
  rect: DOMRect
}

export interface ImageExplainRequest {
  imageDataUrl: string
  altText: string
  caption: string
  context: string
  teachingMode: TeachingMode
  bookTitle?: string
  chapterTitle?: string
}

export interface ExplainRequest {
  selectedText: string
  context: string
  teachingMode: TeachingMode
  bookTitle?: string
  chapterTitle?: string
}

export interface GenerateQuizRequest {
  chapterId: string
  chapterTitle: string
  chapterContent: string
  questionCount: number
  quizPreset: QuizPreset
  // When regenerating, the texts of the previous quiz's questions so the model
  // can avoid repeating them.
  avoidQuestions?: string[]
}

export interface GradeQuizRequest {
  questions: QuizQuestion[]
  answers: QuizAnswer[]
}

export interface AnalyzeWeakPointsRequest {
  chapterId: string
  chapterContent: string
  questions: QuizQuestion[]
  answers: QuizAnswer[]
  results: { questionId: string; correct: boolean; feedback: string }[]
  teachingMode: TeachingMode
}

export type ReadingMode = 'scroll' | 'paged'

export interface GenerateDigestRequest {
  chapterId: string
  chapterTitle: string
  chapterContent: string
}

export interface SpeculaAPI {
  books: {
    import: () => Promise<Book | null>
    importFromStoragePath: (filePath: string, originalName?: string) => Promise<Book | null>
    list: () => Promise<Book[]>
    delete: (id: string) => Promise<void>
    get: (id: string) => Promise<Book | null>
    getFileData: (id: string) => Promise<Uint8Array>
    getProgress: (bookId: string) => Promise<ReadingProgress | null>
    saveProgress: (progress: Omit<ReadingProgress, 'updatedAt'>) => Promise<void>
    getCoverUrl: (coverPath: string | null) => Promise<string | null>
  }
  chapters: {
    listByBook: (bookId: string) => Promise<Chapter[]>
    getContent: (chapterId: string) => Promise<string>
  }
  quickBrowse: {
    getProgress: (bookId: string) => Promise<QuickBrowseProgress>
    prepare: (bookId: string, chapterId: string) => Promise<QuickBrowseProgress>
    answer: (bookId: string, cardId: string, status: 'confident' | 'gap') => Promise<ChapterDigest>
    repair: (bookId: string, cardId: string) => Promise<ChapterDigest>
    reset: (bookId: string, chapterId: string) => Promise<void>
    track: (bookId: string, eventName: string, chapterId?: string, properties?: Record<string, unknown>) => Promise<void>
  }
  epub: {
    getChapterHtml: (bookId: string, href: string) => Promise<string>
  }
  highlights: {
    create: (data: Omit<Highlight, 'id' | 'createdAt'>) => Promise<Highlight>
    listByBook: (bookId: string) => Promise<Highlight[]>
    delete: (id: string) => Promise<void>
    createFromWeakPoints: (data: {
      bookId: string
      chapterId: string
      weakPoints: WeakPoint[]
    }) => Promise<Highlight[]>
  }
  ai: {
    explain: (req: ExplainRequest) => Promise<string>
    explainStream: (req: ExplainRequest) => Promise<void>
    explainImageStream: (req: ImageExplainRequest) => Promise<void>
    explainImageNeed: (req: ImageExplainNeedRequest) => Promise<StructuredExplanation>
    explainCode: (req: ExplainCodeRequest) => Promise<CodeExplanationResult>
    explainFormula: (req: ExplainFormulaRequest) => Promise<FormulaExplanationResult>
    inferNeed: (bookId: string, selectedText: string) => Promise<InferredExplanationNeed | null>
    explainNeed: (req: ExplainNeedRequest) => Promise<StructuredExplanation>
    recordNeedSwitch: (data: {
      bookId: string
      chapterId: string | null
      inferredNeed: ExplanationNeed | null
      from: ExplanationNeed
      to: ExplanationNeed
    }) => Promise<void>
    markNeedsReview: (data: {
      bookId: string
      chapterId: string | null
      selectedText: string
      question: string
    }) => Promise<void>
    saveFlashcard: (data: {
      bookId: string
      chapterId: string | null
      selectedText: string
      front: string
      back: string
    }) => Promise<void>
    saveExploration: (data: {
      bookId: string
      chapterId: string | null
      selectedText: string
      question: string
    }) => Promise<void>
    createLearningTask: (data: {
      bookId: string
      chapterId: string | null
      task: string
    }) => Promise<void>
    onExplainChunk: (
      callback: (chunk: string) => void,
      onError?: (message: string) => void
    ) => () => void
    generateQuiz: (req: GenerateQuizRequest) => Promise<Quiz>
    gradeQuiz: (req: GradeQuizRequest) => Promise<{
      score: number
      results: { questionId: string; correct: boolean; feedback: string }[]
    }>
    analyzeWeakPoints: (req: AnalyzeWeakPointsRequest) => Promise<WeakPoint[]>
  }
  quiz: {
    getByChapter: (chapterId: string) => Promise<Quiz | null>
    saveAttempt: (attempt: Omit<QuizAttempt, 'id' | 'createdAt'>) => Promise<QuizAttempt>
    getAttempts: (quizId: string) => Promise<QuizAttempt[]>
    getLatestAttempt: (quizId: string) => Promise<QuizAttempt | null>
    getHistoryByChapter: (chapterId: string) => Promise<QuizAttempt[]>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (settings: Partial<AppSettings>) => Promise<AppSettings>
    testConnection: () => Promise<{ ok: boolean; message: string }>
    testVision: () => Promise<{ ok: boolean; message: string }>
    listTextModels: (creds?: { apiKey: string; baseURL: string }) => Promise<{
      ok: boolean
      models: string[]
      message?: string
    }>
    listVisionModels: (creds?: { apiKey: string; baseURL: string }) => Promise<{
      ok: boolean
      models: string[]
      message?: string
    }>
  }
}

declare global {
  interface Window {
    specula: SpeculaAPI
  }
}

export const TEACHING_MODE_LABELS: Record<TeachingMode, string> = {
  direct: '直述式',
  socratic: '苏格拉底式',
  feynman: '费曼式',
  analogy: '类比式',
  case: '案例式',
  contrast: '对比式',
  story: '故事式',
  structure: '结构图解式',
  summary: '要点速览',
  practice: '实践应用式',
  history: '历史溯源式',
}

export const TEACHING_MODE_DESCRIPTIONS: Record<TeachingMode, string> = {
  direct: '清晰、结构化地解释选中内容',
  socratic: '通过引导性问题启发思考，不直接给答案',
  feynman: '用简单语言解释，并请你用自己的话复述',
  analogy: '用生活化类比帮助理解抽象概念',
  case: '用真实案例和实例讲解概念',
  contrast: '对比易混淆的相近概念，厘清边界',
  story: '用叙事或情境把你带入并理解',
  structure: '用提纲与层级梳理知识结构',
  summary: '极简 TL;DR，快速抓住要点复习',
  practice: '聚焦如何应用、怎么动手实践',
  history: '追溯概念的由来与演变脉络',
}

export const EXPLANATION_NEED_LABELS: Record<ExplanationNeed, string> = {
  not_understood: '完全没懂',
  clarify: '再讲透一点',
  memorize: '帮我记住',
  why_design: '为什么这样设计',
  apply: '怎么用起来',
}
