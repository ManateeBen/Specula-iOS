import { AlertTriangle, Highlighter, X } from 'lucide-react'
import type { Highlight } from '../types'
import MarkdownContent from './MarkdownContent'

interface Props {
  highlight: Highlight
  weakPointIndex: number | null
  onClose: () => void
  onDelete: (id: string) => void
}

export default function HighlightCard({ highlight, weakPointIndex, onClose, onDelete }: Props) {
  const isWeakPoint = highlight.source === 'quiz'

  return (
    <div className="highlight-card-scrim" onClick={onClose}>
      <div className="highlight-card" onClick={(event) => event.stopPropagation()}>
        <div className="highlight-card__handle" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {isWeakPoint ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-orange-400" />
            ) : (
              <Highlighter className="h-4 w-4 shrink-0 text-yellow-400" />
            )}
            <div className="truncate text-sm font-medium">
              {isWeakPoint ? `薄弱点${weakPointIndex ? ` #${weakPointIndex}` : ''}` : '划线解释'}
            </div>
          </div>
          <button className="highlight-card__close" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <blockquote className={`highlight-card__quote ${isWeakPoint ? 'highlight-card__quote--weak' : ''}`}>
          {highlight.selectedText}
        </blockquote>

        {isWeakPoint && highlight.weakPointTopic && (
          <div className="highlight-card__topic">{highlight.weakPointTopic}</div>
        )}

        {highlight.aiExplanation ? (
          <MarkdownContent className="highlight-card__body">{highlight.aiExplanation}</MarkdownContent>
        ) : (
          <div className="highlight-card__empty">暂无解释内容</div>
        )}

        <div className="highlight-card__footer">
          <button className="text-sm text-red-400 hover:text-red-300" onClick={() => onDelete(highlight.id)}>
            {isWeakPoint ? '移除标记' : '删除划线'}
          </button>
        </div>
      </div>
    </div>
  )
}
