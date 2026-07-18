import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import type { Book, Chapter, ChapterDigest, ReadingProgress } from '../types'

interface RecordMeta {
  chapters: Chapter[]
  progress: ReadingProgress | null
  percent: number
  currentChapter: Chapter | null
  openGaps: ChapterDigest[]
}

const sleeveColors = ['#2743d6', '#161616', '#bd3e27', '#176b5f', '#76384f', '#315469']

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function calculateProgress(chapters: Chapter[], progress: ReadingProgress | null): number {
  if (!progress || chapters.length === 0) return 0
  const chapterIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === progress.chapterId))
  const position = clamp(Number.parseFloat(progress.position) || 0)
  return clamp((chapterIndex + position) / chapters.length)
}

function formatDate(value?: string | null): string {
  const date = value ? new Date(value) : new Date()
  return new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit' })
    .format(date)
    .toUpperCase()
}

export default function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const [metadata, setMetadata] = useState<Record<string, RecordMeta>>({})
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadBooks = async () => {
    setLoading(true)
    const list = await window.specula.books.list()
    setBooks(list)

    const entries = await Promise.all(list.map(async (book) => {
      const [cover, chapters, progress, quickBrowse] = await Promise.all([
        window.specula.books.getCoverUrl(book.coverPath),
        window.specula.chapters.listByBook(book.id),
        window.specula.books.getProgress(book.id),
        window.specula.quickBrowse.getProgress(book.id).catch(() => null),
      ])
      const currentChapter = chapters.find((chapter) => chapter.id === progress?.chapterId) || chapters[0] || null
      return [book.id, {
        cover,
        meta: {
          chapters,
          progress,
          percent: calculateProgress(chapters, progress),
          currentChapter,
          openGaps: quickBrowse?.digests.filter((digest) => digest.status === 'gap') || [],
        } satisfies RecordMeta,
      }] as const
    }))

    setCovers(Object.fromEntries(entries.map(([id, value]) => [id, value.cover])))
    setMetadata(Object.fromEntries(entries.map(([id, value]) => [id, value.meta])))
    setLoading(false)
  }

  useEffect(() => {
    void loadBooks()
    window.addEventListener('specula:library-updated', loadBooks)
    return () => window.removeEventListener('specula:library-updated', loadBooks)
  }, [])

  const handleImport = async () => {
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const book = await window.specula.books.import()
      if (book) {
        await loadBooks()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入书籍失败')
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!confirm('确定从唱片架移除这本书吗？')) return
    try {
      await window.specula.books.delete(id)
      await loadBooks()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除书籍失败')
    }
  }

  const nowReading = useMemo(() => {
    return books
      .filter((book) => metadata[book.id]?.progress && metadata[book.id]?.percent < 0.995)
      .sort((a, b) => {
        const aTime = new Date(metadata[a.id]?.progress?.updatedAt || 0).getTime()
        const bTime = new Date(metadata[b.id]?.progress?.updatedAt || 0).getTime()
        return bTime - aTime
      })[0] || null
  }, [books, metadata])

  const totalTracks = Object.values(metadata).reduce((total, item) => total + item.chapters.length, 0)
  const totalOpen = Object.values(metadata).reduce((total, item) => total + item.openGaps.length, 0)
  const inRotation = Object.values(metadata).filter((item) => item.percent > 0 && item.percent < 0.995).length
  const nowMeta = nowReading ? metadata[nowReading.id] : null
  const nowPercent = Math.round((nowMeta?.percent || 0) * 100)
  const nowGap = nowMeta?.openGaps.find((gap) => gap.chapterId === nowMeta.currentChapter?.id) || nowMeta?.openGaps[0]

  return (
    <div className="records-library" aria-label="library-page">
      <header className="records-masthead">
        <div>
          <h1>SPECULA</h1>
          <p>READING · PRESSED DAILY</p>
        </div>
        <button type="button" onClick={handleImport} disabled={importing} aria-label="import-book">
          <Plus aria-hidden />
          {importing ? '导入中' : '导入 EPUB'}
        </button>
      </header>

      <main className="records-library__main">
        {error && <div className="records-alert records-alert--error">{error}</div>}
        {notice && <div className="records-alert">{notice}</div>}

        {nowReading && nowMeta && (
          <Link to={`/reader/${nowReading.id}`} className="now-playing-card" aria-label={`继续阅读-${nowReading.title}`}>
            <span className="now-playing-card__label">NOW READING</span>
            <div className="vinyl-progress" style={{ '--record-progress': `${nowPercent}%` } as React.CSSProperties}>
              <div className="vinyl-progress__disc" />
              <span>{nowPercent}%</span>
            </div>
            <div className="now-playing-card__copy">
              <p className="records-mono">
                TRACK {String((nowMeta.currentChapter?.orderIndex || 0) + 1).padStart(2, '0')} / {String(nowMeta.chapters.length).padStart(2, '0')}
              </p>
              <h2>{nowMeta.currentChapter?.title || nowReading.title}</h2>
              {nowGap ? (
                <p className="now-playing-card__question">未解问题：<strong>{nowGap.question}</strong></p>
              ) : (
                <p className="now-playing-card__question">正在播放：<strong>{nowReading.title}</strong></p>
              )}
              <span className="now-playing-card__continue"><i>▶</i> 继续播放</span>
            </div>
          </Link>
        )}

        <div className="records-ticker" aria-label="library-stats">
          <span>THIS WEEK</span>
          <span>IN ROTATION <b>{inRotation}</b></span>
          <span>TRACKS <b>{totalTracks}</b></span>
          <span className="records-ticker__accent">OPEN <b>{totalOpen}</b></span>
        </div>

        <div className="records-section-title">
          <h2>COLLECTION</h2>
          <span>{books.length} RECORDS</span>
        </div>

        {loading ? (
          <div className="records-empty">CATALOGING RECORDS...</div>
        ) : (
          <div className="record-crate">
            {books.map((book, index) => {
              const meta = metadata[book.id]
              const percent = Math.round((meta?.percent || 0) * 100)
              const complete = percent >= 100
              return (
                <Link key={book.id} to={`/reader/${book.id}`} className="record-item" aria-label={`book-${book.title}`}>
                  <div className="record-sleeve" style={{ backgroundColor: sleeveColors[index % sleeveColors.length] }}>
                    {covers[book.id] && <img src={covers[book.id]!} alt="" className="record-sleeve__art" />}
                    <div className="record-sleeve__veil" />
                    <span className="record-sleeve__catalog">SPC-{String(index + 1).padStart(3, '0')} · {book.format.toUpperCase()}</span>
                    {complete && <span className="hype-sticker">READ<br />COMPLETE<br />{formatDate(meta?.progress?.updatedAt)}</span>}
                    <span className="record-sleeve__number">{String(index + 1).padStart(2, '0')}</span>
                    <h3>{book.title}</h3>
                    <span className="record-sleeve__tracks">{meta?.chapters.length || 0} TRACKS · {book.author || 'UNKNOWN ARTIST'}</span>
                    <button
                      type="button"
                      onClick={(event) => void handleDelete(book.id, event)}
                      className="record-sleeve__delete"
                      style={complete ? { top: 75 } : undefined}
                      aria-label="删除书籍"
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                  <div className="record-item__meta">
                    <strong>{book.title}</strong>
                    <span>{complete ? 'COMPLETE' : `${percent}%`} · {meta?.openGaps.length || 0} OPEN</span>
                    <i><b style={{ width: `${percent}%` }} /></i>
                  </div>
                </Link>
              )
            })}

            <button type="button" onClick={handleImport} className="record-slot" aria-label="import-another-epub">
              <Plus aria-hidden />
              <span>NEW EPUB</span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
