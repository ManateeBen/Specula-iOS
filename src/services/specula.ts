import type {
  SpeculaAPI,
  ExplainRequest,
  GenerateQuizRequest,
  GradeQuizRequest,
  AnalyzeWeakPointsRequest,
  AppSettings,
  ReadingProgress,
  Highlight,
  WeakPoint,
} from '../types'
import * as bookService from './book.service'
import * as aiService from './ai.service'
import * as settingsService from './settings.service'
import * as quickBrowseService from './quickBrowse.service'
import * as explanationService from './explanation.service'
import { getFileUrl } from './storage'
import { onExplainChunk } from './streamEvents'

export const speculaApi: SpeculaAPI = {
  books: {
    import: () => bookService.importBook(),
    importFromStoragePath: (filePath, originalName) =>
      bookService.importBookFromStoragePath(filePath, originalName),
    list: () => Promise.resolve(bookService.listBooks()),
    delete: (id) => bookService.deleteBook(id),
    get: (id) => Promise.resolve(bookService.getBook(id)),
    getFileData: (id) => bookService.getFileData(id),
    getProgress: (bookId) => Promise.resolve(bookService.getProgress(bookId)),
    saveProgress: (progress: Omit<ReadingProgress, 'updatedAt'>) => {
      bookService.saveProgress(progress.bookId, progress.chapterId, progress.position)
      return Promise.resolve()
    },
    getCoverUrl: (coverPath) => getFileUrl(coverPath),
  },
  chapters: {
    listByBook: (bookId) => Promise.resolve(bookService.listChapters(bookId)),
    getContent: (chapterId) => bookService.getChapterContent(chapterId),
  },
  quickBrowse: {
    getProgress: (bookId) => Promise.resolve(quickBrowseService.getProgress(bookId)),
    prepare: (bookId, chapterId) => quickBrowseService.prepare(bookId, chapterId),
    answer: (bookId, cardId, status) => Promise.resolve(quickBrowseService.answer(bookId, cardId, status)),
    repair: (bookId, cardId) => Promise.resolve(quickBrowseService.repair(bookId, cardId)),
    reset: (bookId, chapterId) => {
      quickBrowseService.reset(bookId, chapterId)
      return Promise.resolve()
    },
    track: (bookId, eventName, chapterId, properties) => {
      quickBrowseService.track(bookId, eventName, chapterId, properties)
      return Promise.resolve()
    },
  },
  epub: {
    getChapterHtml: (bookId, href) => bookService.getEpubChapterHtml(bookId, href),
  },
  highlights: {
    create: (data) => {
      const id = bookService.createHighlight(data)
      return Promise.resolve({
        id,
        ...data,
        source: data.source || 'user',
        weakPointTopic: data.weakPointTopic || null,
        weakPointIndex: null,
        createdAt: new Date().toISOString(),
      } as Highlight)
    },
    listByBook: (bookId) =>
      Promise.resolve(
        bookService.listHighlights(bookId).map((h) => ({
          id: h.id,
          bookId: h.book_id,
          chapterId: h.chapter_id,
          selectedText: h.selected_text,
          context: h.context,
          aiExplanation: h.ai_explanation,
          teachingMode: h.teaching_mode as Highlight['teachingMode'],
          source: (h.source || 'user') as Highlight['source'],
          weakPointTopic: h.weak_point_topic || null,
          weakPointIndex: h.weak_point_index ?? null,
          createdAt: h.created_at,
        }))
      ),
    delete: (id) => {
      bookService.deleteHighlight(id)
      return Promise.resolve()
    },
    createFromWeakPoints: (data: { bookId: string; chapterId: string; weakPoints: WeakPoint[] }) =>
      Promise.resolve(bookService.createHighlightsFromWeakPoints(data)),
  },
  ai: {
    explain: (req: ExplainRequest) => aiService.explainText(req),
    explainStream: (req: ExplainRequest) => aiService.explainTextStream(req),
    explainImageStream: (req) => aiService.explainImageStream(req),
    explainImageNeed: (req) => explanationService.explainImageNeed(req),
    inferNeed: (bookId, selectedText) => Promise.resolve(explanationService.inferNeed(bookId, selectedText)),
    explainNeed: (req) => explanationService.explainNeed(req),
    recordNeedSwitch: (data) => {
      explanationService.recordNeedSwitch(data)
      return Promise.resolve()
    },
    markNeedsReview: (data) => {
      explanationService.markNeedsReview(data)
      return Promise.resolve()
    },
    saveFlashcard: (data) => {
      explanationService.saveFlashcard(data)
      return Promise.resolve()
    },
    saveExploration: (data) => {
      explanationService.saveExploration(data)
      return Promise.resolve()
    },
    createLearningTask: (data) => explanationService.createLearningTask(data),
    onExplainChunk,
    generateQuiz: (req: GenerateQuizRequest) => aiService.generateQuiz(req),
    gradeQuiz: (req: GradeQuizRequest) => aiService.gradeQuiz(req),
    analyzeWeakPoints: (req: AnalyzeWeakPointsRequest) => aiService.analyzeWeakPoints(req),
  },
  quiz: {
    getByChapter: (chapterId) => Promise.resolve(aiService.getQuizByChapter(chapterId)),
    saveAttempt: (attempt) => Promise.resolve(aiService.saveQuizAttempt(attempt)),
    getAttempts: (quizId) => Promise.resolve(aiService.getQuizAttempts(quizId)),
    getLatestAttempt: (quizId) => Promise.resolve(aiService.getLatestQuizAttempt(quizId)),
    getHistoryByChapter: (chapterId) => Promise.resolve(aiService.getQuizHistoryByChapter(chapterId)),
  },
  settings: {
    get: () => settingsService.getSettings(),
    set: (settings: Partial<AppSettings>) => settingsService.setSettings(settings),
    testConnection: () => aiService.testConnection(),
    testVision: () => aiService.testVision(),
    listTextModels: (creds) => aiService.listTextModels(creds),
    listVisionModels: (creds) => aiService.listVisionModels(creds),
  },
}

export function installSpeculaApi(): void {
  window.specula = speculaApi
}
