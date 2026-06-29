import { useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import TeachingModePicker from './TeachingModePicker'
import type { TeachingMode } from '../types'
import { useSettingsStore } from '../stores/settingsStore'

interface SelectionInfo {
  text: string
  context: string
  rect: DOMRect
}

interface Props {
  selection: SelectionInfo
  bookId: string
  chapterId: string | null
  bookTitle?: string
  chapterTitle?: string
  action: 'explain' | 'explain-highlight'
  onClose: () => void
  onSaved: () => void
}

export default function HighlightPopover({
  selection,
  bookId,
  chapterId,
  bookTitle,
  chapterTitle,
  action,
  onClose,
  onSaved,
}: Props) {
  const defaultMode = useSettingsStore((s) => s.defaultTeachingMode)
  const [mode, setMode] = useState<TeachingMode>(defaultMode)
  const [loading, setLoading] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const runExplain = async () => {
    setLoading(true)
    setExplanation('')
    setError('')
    setStreaming(true)
    setSaved(false)

    let nextExplanation = ''
    const cleanup = window.specula.ai.onExplainChunk(
      (chunk) => {
        nextExplanation += chunk
        setExplanation((prev) => prev + chunk)
      },
      (message) => {
        setError(message || 'AI 解释失败')
        setLoading(false)
        setStreaming(false)
      }
    )

    try {
      await window.specula.ai.explainStream({
        selectedText: selection.text,
        context: selection.context,
        teachingMode: mode,
        bookTitle,
        chapterTitle,
      })

      if (action === 'explain-highlight') {
        await window.specula.highlights.create({
          bookId,
          chapterId,
          selectedText: selection.text,
          context: selection.context,
          aiExplanation: nextExplanation || null,
          teachingMode: mode,
          source: 'user',
          weakPointTopic: null,
          weakPointIndex: null,
        })
        setSaved(true)
        onSaved()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 解释失败')
    } finally {
      cleanup()
      setLoading(false)
      setStreaming(false)
    }
  }

  const isNarrow = window.innerWidth < 640
  const popoverWidth = Math.min(380, window.innerWidth - 24)
  const popoverMaxHeight = Math.min(520, window.innerHeight - 32)
  const top = Math.min(
    Math.max(16, selection.rect.bottom + 8),
    Math.max(16, window.innerHeight - popoverMaxHeight - 16)
  )
  const left = Math.min(
    Math.max(12, selection.rect.left),
    Math.max(12, window.innerWidth - popoverWidth - 12)
  )
  const style: React.CSSProperties = isNarrow
    ? {
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(env(safe-area-inset-bottom) + 72px)',
        zIndex: 1000,
        maxHeight: 'min(68vh, calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 132px))',
      }
    : {
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        width: popoverWidth,
        maxHeight: popoverMaxHeight,
      }

  return (
    <div style={style} className="card flex flex-col overflow-hidden shadow-lg">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="text-sm font-medium">
          {action === 'explain-highlight' ? 'AI 解释并高亮' : 'AI 解释'}
        </span>
        <button onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <blockquote className="border-l-2 border-yellow-400 pl-2 text-xs italic text-gray-600 dark:text-gray-400">
          {selection.text.slice(0, 120)}
          {selection.text.length > 120 ? '...' : ''}
        </blockquote>

        <TeachingModePicker value={mode} onChange={setMode} compact />

        {!explanation && !loading && (
          <button onClick={runExplain} className="btn-primary w-full">
            <Sparkles className="h-4 w-4" />
            {action === 'explain-highlight' ? '解释并高亮' : '生成解释'}
          </button>
        )}

        {loading && !explanation && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在思考...
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {explanation && (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{explanation}</div>
            {streaming && <Loader2 className="mt-2 h-4 w-4 animate-spin text-specula-500" />}
          </div>
        )}
      </div>

      {action === 'explain-highlight' && saved && !streaming && (
        <div className="flex items-center justify-center gap-2 border-t border-gray-200 p-3 text-sm text-green-600 dark:border-gray-700 dark:text-green-400">
          <Sparkles className="h-4 w-4" />
          已保存为高亮
        </div>
      )}
    </div>
  )
}
