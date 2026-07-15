import { v4 as uuidv4 } from 'uuid'
import type { ChapterDigest, QuickBrowseProgress } from '../types'
import { queryAll, queryOne, runSql } from './db'
import * as bookService from './book.service'
import { generateChapterDigest } from './ai.service'

const UI_TESTING = import.meta.env.VITE_UI_TESTING === 'true'

function makeUiTestDigest(chapterTitle: string, content: string) {
  return {
    title: `${chapterTitle} 的核心判断`,
    summary: '本章给出一个关键结论。它能帮助读者建立清晰框架。真正的理解仍取决于正文中的机制。',
    keyTerms: ['关键结论', '机制'],
    question: '为什么仅知道这个结论，还不足以真正理解本章？',
    answerAnchor: content.trim().slice(0, 30),
  }
}

interface DigestRow {
  [key: string]: unknown
  chapter_id: string
  chapter_title: string
  order_index: number
  title: string
  summary: string
  key_terms_json: string
  question: string
  answer_anchor: string
  status: string | null
  answered_at: string | null
  updated_at: string
}

function rowToDigest(row: DigestRow): ChapterDigest {
  return {
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterOrder: row.order_index,
    title: row.title,
    summary: row.summary,
    keyTerms: JSON.parse(row.key_terms_json || '[]'),
    question: row.question,
    answerAnchor: row.answer_anchor,
    status: (row.status || 'unanswered') as ChapterDigest['status'],
    answeredAt: row.answered_at,
    updatedAt: row.updated_at,
  }
}

export function getProgress(bookId: string): QuickBrowseProgress {
  const digests = queryAll<DigestRow>(
    `SELECT d.chapter_id, c.title AS chapter_title, c.order_index, d.title, d.summary,
            d.key_terms_json, d.question, d.answer_anchor, a.status, a.answered_at, d.updated_at
     FROM quick_browse_digests d
     JOIN chapters c ON c.id = d.chapter_id
     LEFT JOIN quick_browse_answers a ON a.book_id = d.book_id AND a.chapter_id = d.chapter_id
     WHERE d.book_id = ? AND d.generation_status = 'ready'
     ORDER BY c.order_index`,
    [bookId]
  ).map(rowToDigest)
  const eligibleChapterCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM chapters WHERE book_id = ?',
    [bookId]
  )?.count || 0
  const attemptedCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quick_browse_digests WHERE book_id = ?',
    [bookId]
  )?.count || 0
  return {
    bookId,
    digests,
    generationComplete: eligibleChapterCount > 0 && attemptedCount >= eligibleChapterCount,
    generatedCount: digests.length,
    eligibleChapterCount,
  }
}

export async function prepare(bookId: string, chapterId: string): Promise<QuickBrowseProgress> {
  const chapters = bookService.listChapters(bookId).filter((chapter) => chapter.id === chapterId)
  for (const chapter of chapters) {
    const existing = queryOne<{ chapter_id: string; generation_status: string }>(
      'SELECT chapter_id, generation_status FROM quick_browse_digests WHERE chapter_id = ?',
      [chapter.id]
    )
    if (existing?.generation_status === 'ready' || (existing && !UI_TESTING)) continue
    if (existing) runSql('DELETE FROM quick_browse_digests WHERE chapter_id = ?', [chapter.id])

    const content = await bookService.getChapterContent(chapter.id)
    if (content.replace(/\s+/g, '').length < 80) {
      runSql(
        `INSERT INTO quick_browse_digests
          (chapter_id, book_id, title, summary, key_terms_json, question, answer_anchor, generation_status)
         VALUES (?, ?, '', '', '[]', '', '', 'failed')`,
        [chapter.id, bookId]
      )
      continue
    }

    let digest = UI_TESTING ? makeUiTestDigest(chapter.title, content) : null
    try {
      if (!digest) {
        digest = await generateChapterDigest({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterContent: content,
        })
      }
    } catch {
      digest = null
    }

    runSql(
      `INSERT INTO quick_browse_digests
        (chapter_id, book_id, title, summary, key_terms_json, question, answer_anchor, generation_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        chapter.id,
        bookId,
        digest?.title || '',
        digest?.summary || '',
        JSON.stringify(digest?.keyTerms || []),
        digest?.question || '',
        digest?.answerAnchor || '',
        digest ? 'ready' : 'failed',
      ]
    )
  }
  return getProgress(bookId)
}

export function answer(bookId: string, chapterId: string, status: 'confident' | 'gap'): ChapterDigest {
  runSql(
    `INSERT INTO quick_browse_answers (book_id, chapter_id, status, answered_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(book_id, chapter_id) DO NOTHING`,
    [bookId, chapterId, status]
  )
  track(bookId, 'quick_browse_answered', chapterId, { status })
  const digest = getProgress(bookId).digests.find((item) => item.chapterId === chapterId)
  if (!digest) throw new Error('快速浏览卡片不存在')
  return digest
}

export function repair(bookId: string, chapterId: string): ChapterDigest {
  runSql(
    `UPDATE quick_browse_answers SET status = 'repaired', answered_at = datetime('now')
     WHERE book_id = ? AND chapter_id = ? AND status = 'gap'`,
    [bookId, chapterId]
  )
  track(bookId, 'quick_browse_gap_repaired', chapterId)
  const digest = getProgress(bookId).digests.find((item) => item.chapterId === chapterId)
  if (!digest) throw new Error('认知缺口不存在')
  return digest
}

export function reset(bookId: string, chapterId: string): void {
  runSql('DELETE FROM quick_browse_answers WHERE book_id = ? AND chapter_id = ?', [bookId, chapterId])
  track(bookId, 'quick_browse_reset', chapterId)
}

export function track(
  bookId: string,
  eventName: string,
  chapterId?: string,
  properties: Record<string, unknown> = {}
): void {
  try {
    runSql(
      `INSERT INTO analytics_events (id, book_id, chapter_id, event_name, properties_json)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), bookId, chapterId || null, eventName, JSON.stringify(properties)]
    )
  } catch (error) {
    console.warn('Quick browse analytics event was not persisted', eventName, error)
  }
}
