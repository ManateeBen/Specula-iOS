import { useState } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
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
  onClose: () => void
  onSaved: () => void
}

export default function HighlightPopover({
  selection,
  bookId,
  chapterId,
  bookTitle,
  chapterTitle,
  onClose,
  onSaved,
}: Props) {
  const defaultMode = useSettingsStore((s) => s.defaultTeachingMode)
  const [mode, setMode] = useState<TeachingMode>(defaultMode)
  const [loading, setLoading] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')

  const handleExplain = async () => {
    setLoading(true)
    setExplanation('')
    setError('')
    setStreaming(true)

    const cleanup = window.specula.ai.onExplainChunk(
      (chunk) => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 解释失败')
    } finally {
      cleanup()
      setLoading(false)
      setStreaming(false)
    }
  }

  const handleSave = async () => {
    await window.specula.highlights.create({
      bookId,
      chapterId,
      selectedText: selection.text,
      context: selection.context,
      aiExplanation: explanation || null,
      teachingMode: mode,
      source: 'user',
    })
    onSaved()
    onClose()
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(selection.rect.bottom + 8, window.innerHeight - 400),
    left: Math.min(selection.rect.left, window.innerWidth - 380),
    zIndex: 1000,
    width: 360,
    maxHeight: 380,
  }

  return (
    <div style={style} className="card flex flex-col overflow-hidden shadow-lg">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="text-sm font-medium">AI 解释</span>
        <button onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto p-3">
        <blockquote className="border-l-2 border-yellow-400 pl-2 text-xs italic text-gray-600 dark:text-gray-400">
          {selection.text.slice(0, 120)}
          {selection.text.length > 120 ? '...' : ''}
        </blockquote>

        <TeachingModePicker value={mode} onChange={setMode} compact />

        {!explanation && !loading && (
          <button onClick={handleExplain} className="btn-primary w-full">
            <Sparkles className="h-4 w-4" />
            生成解释
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

      {explanation && !streaming && (
        <div className="border-t border-gray-200 p-3 dark:border-gray-700">
          <button onClick={handleSave} className="btn-primary w-full">
            保存划线
          </button>
        </div>
      )}
    </div>
  )
}
