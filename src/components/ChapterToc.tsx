import { X } from 'lucide-react'
import type { Chapter } from '../types'

interface Props {
  chapters: Chapter[]
  currentChapterId: string | null
  onSelect: (chapterId: string) => void
  onClose: () => void
}

export default function ChapterToc({ chapters, currentChapterId, onSelect, onClose }: Props) {
  return (
    <div className="records-toc" aria-label="record-toc">
      <header className="records-toc__header">
        <div>
          <span>SPECULA RECORDS</span>
          <h2>TRACK LIST</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭目录" title="关闭目录">
          <X />
        </button>
      </header>
      <div className="records-toc__meta">
        <span>SIDE A</span>
        <span>{String(chapters.length).padStart(2, '0')} TRACKS</span>
      </div>
      <nav className="records-toc__list">
        {chapters.length === 0 ? (
          <p className="records-toc__empty">NO TRACKS YET</p>
        ) : (
          <ol>
            {chapters.map((ch, i) => {
              const active = ch.id === currentChapterId
              return (
                <li key={ch.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(ch.id)}
                    className={active ? 'is-playing' : ''}
                    aria-current={active ? 'page' : undefined}
                    aria-label={`toc-track-${i + 1}`}
                  >
                    <span className="records-toc__number">{String(i + 1).padStart(2, '0')}</span>
                    <span className="records-toc__title">{ch.title}</span>
                    {active && <small>PLAYING</small>}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </nav>
      <footer>SELECT A TRACK · KEEP READING</footer>
    </div>
  )
}
