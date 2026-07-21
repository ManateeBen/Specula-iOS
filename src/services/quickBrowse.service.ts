import { v4 as uuidv4 } from 'uuid'
import type { ChapterDigest, QuickBrowseProgress } from '../types'
import { queryAll, queryOne, runMany, runSql } from './db'
import * as bookService from './book.service'
import { generateChapterDigests } from './ai.service'

const UI_TESTING = import.meta.env.VITE_UI_TESTING === 'true'
const MIN_CARD_COUNT = 1
const DIGEST_QUALITY_VERSION = 3

function makeUiTestDigests(chapterTitle: string, content: string) {
  const anchors = [0].map((offset) => content.trim().slice(offset, offset + 30))
  return anchors.map((answerAnchor, index) => ({
    title: `${chapterTitle} 的核心判断 ${index + 1}`,
    summary: `本章提出第 ${index + 1} 个关键结论。它构成理解本章的核心支点。具体机制仍需回到正文确认。`,
    keyTerms: ['关键结论', '核心支点'],
    question: '如果拿掉支撑这个结论的关键机制，为什么本章的主张就无法成立？',
    answerAnchor,
    evidenceText: answerAnchor,
    expectedAnswer: '需要回到这段原文，根据其中的机制说明作答。',
    qualityVersion: DIGEST_QUALITY_VERSION,
  }))
}

interface DigestRow {
  [key: string]: unknown
  id: string
  chapter_id: string
  chapter_title: string
  order_index: number
  card_index: number
  title: string
  summary: string
  key_terms_json: string
  question: string
  answer_anchor: string
  evidence_text: string
  expected_answer: string
  quality_version: number
  status: string | null
  answered_at: string | null
  updated_at: string
}

function rowToDigest(row: DigestRow): ChapterDigest {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    chapterOrder: row.order_index,
    cardIndex: row.card_index,
    title: row.title,
    summary: row.summary,
    keyTerms: JSON.parse(row.key_terms_json || '[]'),
    question: row.question,
    answerAnchor: row.answer_anchor,
    evidenceText: row.evidence_text || row.answer_anchor,
    expectedAnswer: row.expected_answer || '',
    qualityVersion: Number(row.quality_version) || 1,
    status: (row.status || 'unanswered') as ChapterDigest['status'],
    answeredAt: row.answered_at,
    updatedAt: row.updated_at,
  }
}

export function getProgress(bookId: string): QuickBrowseProgress {
  const digests = queryAll<DigestRow>(
    `SELECT d.id, d.chapter_id, c.title AS chapter_title, c.order_index, d.card_index,
            d.title, d.summary, d.key_terms_json, d.question, d.answer_anchor,
            d.evidence_text, d.expected_answer, d.quality_version,
            a.status, a.answered_at, d.updated_at
     FROM quick_browse_cards d
     JOIN chapters c ON c.id = d.chapter_id
     LEFT JOIN quick_browse_card_answers a ON a.book_id = d.book_id AND a.card_id = d.id
     WHERE d.book_id = ?
     ORDER BY c.order_index, d.card_index`,
    [bookId]
  ).map(rowToDigest)
  const eligibleChapterCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM chapters WHERE book_id = ?',
    [bookId]
  )?.count || 0
  const generatedChapterCount = queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM quick_browse_generations
     WHERE book_id = ? AND status = 'ready' AND quality_version >= ?`,
    [bookId, DIGEST_QUALITY_VERSION]
  )?.count || 0
  return {
    bookId,
    digests,
    generationComplete: eligibleChapterCount > 0 && generatedChapterCount >= eligibleChapterCount,
    generatedCount: digests.length,
    eligibleChapterCount,
  }
}

function recordGeneration(bookId: string, chapterId: string, status: 'generating' | 'ready' | 'failed', error = '') {
  runSql(
    `INSERT INTO quick_browse_generations (chapter_id, book_id, status, error_message, quality_version, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(chapter_id) DO UPDATE SET
       status = excluded.status,
       error_message = excluded.error_message,
       quality_version = excluded.quality_version,
       updated_at = datetime('now')`,
    [chapterId, bookId, status, error, DIGEST_QUALITY_VERSION]
  )
}

export async function prepare(bookId: string, chapterId: string): Promise<QuickBrowseProgress> {
  const chapter = bookService.listChapters(bookId).find((item) => item.id === chapterId)
  if (!chapter) throw new Error('没有找到当前章节')

  const existingCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM quick_browse_cards WHERE chapter_id = ?',
    [chapterId]
  )?.count || 0
  const generation = queryOne<{ status: string; quality_version: number }>(
    'SELECT status, quality_version FROM quick_browse_generations WHERE chapter_id = ?',
    [chapterId]
  )
  const groundedCount = queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM quick_browse_cards
     WHERE chapter_id = ? AND quality_version >= ? AND evidence_text <> '' AND expected_answer <> ''`,
    [chapterId, DIGEST_QUALITY_VERSION]
  )?.count || 0
  if (
    generation?.status === 'ready'
    && Number(generation.quality_version) >= DIGEST_QUALITY_VERSION
    && existingCount >= MIN_CARD_COUNT
    && groundedCount === existingCount
  ) return getProgress(bookId)

  recordGeneration(bookId, chapterId, 'generating')
  try {
    const content = await bookService.getChapterContent(chapter.id)
    if (content.replace(/\s+/g, '').length < 80) {
      throw new Error('本章正文太短，暂时无法提炼核心知识卡片')
    }

    const digests = UI_TESTING
      ? makeUiTestDigests(chapter.title, content)
      : await generateChapterDigests({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterContent: content,
        })
    if (digests.length < MIN_CARD_COUNT) {
      throw new Error('核心知识卡片未通过内容或原文锚点校验，请重试')
    }

    const existingIds = queryAll<{ id: string }>(
      'SELECT id FROM quick_browse_cards WHERE chapter_id = ?',
      [chapterId]
    ).map((row) => row.id)
    const statements = [
      ...(existingIds.length > 0 ? [{
        sql: `DELETE FROM quick_browse_card_answers WHERE card_id IN (${existingIds.map(() => '?').join(',')})`,
        params: existingIds,
      }] : []),
      { sql: 'DELETE FROM quick_browse_cards WHERE chapter_id = ?', params: [chapterId] },
      ...digests.slice(0, 5).map((digest, index) => ({
        sql: `INSERT INTO quick_browse_cards
          (id, chapter_id, book_id, card_index, title, summary, key_terms_json, question,
           answer_anchor, evidence_text, expected_answer, quality_version, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        params: [
          uuidv4(), chapterId, bookId, index, digest.title, digest.summary,
          JSON.stringify(digest.keyTerms), digest.question, digest.answerAnchor,
          digest.evidenceText, digest.expectedAnswer, DIGEST_QUALITY_VERSION,
        ],
      })),
      {
        sql: `INSERT INTO quick_browse_generations
              (chapter_id, book_id, status, error_message, quality_version, updated_at)
              VALUES (?, ?, 'ready', '', ?, datetime('now'))
              ON CONFLICT(chapter_id) DO UPDATE SET
                status = 'ready', error_message = '', quality_version = excluded.quality_version,
                updated_at = datetime('now')`,
        params: [chapterId, bookId, DIGEST_QUALITY_VERSION],
      },
    ]
    runMany(statements)
    return getProgress(bookId)
  } catch (error) {
    const message = error instanceof Error ? error.message : '快速浏览卡片生成失败'
    recordGeneration(bookId, chapterId, 'failed', message)
    throw new Error(message)
  }
}

export function answer(bookId: string, cardId: string, status: 'confident' | 'gap'): ChapterDigest {
  runSql(
    `INSERT INTO quick_browse_card_answers (book_id, card_id, status, answered_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(book_id, card_id) DO NOTHING`,
    [bookId, cardId, status]
  )
  const digest = getProgress(bookId).digests.find((item) => item.id === cardId)
  if (!digest) throw new Error('快速浏览卡片不存在')
  track(bookId, 'quick_browse_answered', digest.chapterId, { cardId, status })
  return digest
}

export function repair(bookId: string, cardId: string): ChapterDigest {
  runSql(
    `UPDATE quick_browse_card_answers SET status = 'repaired', answered_at = datetime('now')
     WHERE book_id = ? AND card_id = ? AND status = 'gap'`,
    [bookId, cardId]
  )
  const digest = getProgress(bookId).digests.find((item) => item.id === cardId)
  if (!digest) throw new Error('待答问题不存在')
  track(bookId, 'quick_browse_gap_repaired', digest.chapterId, { cardId })
  return digest
}

export function reset(bookId: string, chapterId: string): void {
  runSql(
    `DELETE FROM quick_browse_card_answers
     WHERE book_id = ? AND card_id IN (SELECT id FROM quick_browse_cards WHERE chapter_id = ?)`,
    [bookId, chapterId]
  )
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
