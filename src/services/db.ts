import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { readBinaryFile, writeBinaryFile, fileExists, ensureDir, BOOKS_DIR, COVERS_DIR } from './storage'

const DB_PATH = 'specula.db'

let db: SqlJsDatabase | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistChain: Promise<void> = Promise.resolve()

function schedulePersist(): void {
  if (!db) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistChain = persistChain.catch(() => {}).then(async () => {
      if (!db) return
      const data = db.export()
      await writeBinaryFile(DB_PATH, data)
    })
  }, 300)
}

async function persistDbSync(): Promise<void> {
  if (!db) return
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const data = db.export()
  await writeBinaryFile(DB_PATH, data)
}

export function getBooksDir(): string {
  return BOOKS_DIR
}

export function getCoversDir(): string {
  return COVERS_DIR
}

export async function initDatabase(): Promise<SqlJsDatabase> {
  if (db) return db

  await ensureDir(BOOKS_DIR)
  await ensureDir(COVERS_DIR)

  const SQL = await initSqlJs({
    locateFile: () => `${import.meta.env.BASE_URL}sql-wasm.wasm`,
  })

  if (await fileExists(DB_PATH)) {
    const buffer = await readBinaryFile(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL CHECK(format IN ('epub', 'pdf')),
      file_path TEXT NOT NULL,
      cover_path TEXT,
      pdf_text_status TEXT,
      pdf_ai_unsupported_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      start_ref TEXT NOT NULL,
      end_ref TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT,
      position TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT,
      selected_text TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      ai_explanation TEXT,
      teaching_mode TEXT,
      source TEXT NOT NULL DEFAULT 'user',
      weak_point_topic TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL UNIQUE REFERENCES chapters(id) ON DELETE CASCADE,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      answers_json TEXT NOT NULL,
      score REAL NOT NULL,
      weak_points_json TEXT NOT NULL DEFAULT '[]',
      results_json TEXT NOT NULL DEFAULT '[]',
      time_taken_ms INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id);
    CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
    CREATE INDEX IF NOT EXISTS idx_quizzes_chapter ON quizzes(chapter_id);
  `)

  try { db.run(`ALTER TABLE highlights ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`) } catch { /* exists */ }
  try { db.run(`ALTER TABLE highlights ADD COLUMN weak_point_topic TEXT`) } catch { /* exists */ }
  try { db.run(`ALTER TABLE highlights ADD COLUMN weak_point_index INTEGER`) } catch { /* exists */ }
  try { db.run(`ALTER TABLE books ADD COLUMN pdf_text_status TEXT`) } catch { /* exists */ }
  try { db.run(`ALTER TABLE books ADD COLUMN pdf_ai_unsupported_reason TEXT`) } catch { /* exists */ }
  try { db.run(`ALTER TABLE quiz_attempts ADD COLUMN results_json TEXT NOT NULL DEFAULT '[]'`) } catch { /* exists */ }
  try { db.run(`ALTER TABLE quiz_attempts ADD COLUMN time_taken_ms INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }
  try { db.run(`ALTER TABLE quiz_attempts ADD COLUMN completed_at TEXT`) } catch { /* exists */ }

  try {
    db.run(`
      UPDATE quiz_attempts
      SET quiz_id = (
        SELECT MIN(q2.id) FROM quizzes q2
        WHERE q2.chapter_id = (SELECT chapter_id FROM quizzes WHERE id = quiz_attempts.quiz_id)
      )
      WHERE EXISTS (SELECT 1 FROM quizzes WHERE id = quiz_attempts.quiz_id)
    `)
    db.run(`DELETE FROM quizzes WHERE id NOT IN (SELECT MIN(id) FROM quizzes GROUP BY chapter_id)`)
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_quizzes_chapter_unique ON quizzes(chapter_id)`)
  } catch { /* dedup best-effort */ }

  await persistDbSync()
  return db
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function runSql(sql: string, params: unknown[] = []): void {
  const database = getDatabase()
  database.run(sql, params as (string | number | null)[])
  schedulePersist()
}

export function runMany(statements: { sql: string; params?: unknown[] }[]): void {
  const database = getDatabase()
  database.run('BEGIN TRANSACTION')
  try {
    for (const s of statements) {
      database.run(s.sql, (s.params || []) as (string | number | null)[])
    }
    database.run('COMMIT')
  } catch (err) {
    database.run('ROLLBACK')
    throw err
  }
  schedulePersist()
}

export function queryAll<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const database = getDatabase()
  const stmt = database.prepare(sql)
  stmt.bind(params as (string | number | null)[])
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

export function queryOne<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const rows = queryAll<T>(sql, params)
  return rows[0]
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await persistDbSync()
    db.close()
    db = null
  }
}
