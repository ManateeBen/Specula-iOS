import { List } from 'lucide-react'
import type { Chapter } from '../types'

interface Props {
  chapters: Chapter[]
  currentChapterId: string | null
  onSelect: (chapterId: string) => void
}

export default function ChapterToc({ chapters, currentChapterId, onSelect }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 text-sm font-medium dark:border-gray-700">
        <List className="h-4 w-4 text-specula-600" />
        目录
        <span className="text-xs font-normal text-gray-400">({chapters.length})</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {chapters.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-gray-500">暂无章节</p>
        ) : (
          <ul className="space-y-0.5">
            {chapters.map((ch, i) => {
              const active = ch.id === currentChapterId
              return (
                <li key={ch.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(ch.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-xs leading-snug transition-colors ${
                      active
                        ? 'bg-specula-100 font-medium text-specula-800 dark:bg-specula-900/40 dark:text-specula-300'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="mr-1.5 text-gray-400">{i + 1}.</span>
                    {ch.title}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </div>
  )
}
