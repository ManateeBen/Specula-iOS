export type BookFormat = 'epub' | 'pdf'

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

export interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  filePath: string
  coverPath: string | null
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
  darkMode: boolean
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
