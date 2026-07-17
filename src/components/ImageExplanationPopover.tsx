import { useState } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
import type { ImageSelectionInfo, TeachingMode } from '../types'
import MarkdownContent from './MarkdownContent'

interface Props {
  selection: ImageSelectionInfo
  bookId: string
  chapterId: string | null
  bookTitle?: string
  chapterTitle?: string
  onClose: () => void
  onSaved: () => void
}

export default function ImageExplanationPopover({
  selection,
  bookId,
  chapterId,
  bookTitle,
  chapterTitle,
  onClose,
  onSaved,
}: Props) {
  const mode: TeachingMode = 'analogy'
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
        setError(message || '图片解释失败')
        setLoading(false)
        setStreaming(false)
      }
    )

    try {
      await window.specula.ai.explainImageStream({
        imageDataUrl: selection.imageDataUrl,
        altText: selection.imageAltText,
        caption: selection.imageCaption,
        context: selection.imageContext,
        teachingMode: mode,
        bookTitle,
        chapterTitle,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片解释失败')
    } finally {
      cleanup()
      setLoading(false)
      setStreaming(false)
    }
  }

  const handleSave = async () => {
    const label = selection.imageCaption || selection.imageAltText || '图片'
    await window.specula.highlights.create({
      bookId,
      chapterId,
      selectedText: `[图片] ${label}`,
      context: selection.imageContext,
      aiExplanation: explanation || null,
      teachingMode: mode,
      source: 'user',
      weakPointTopic: null,
      weakPointIndex: null,
    })
    onSaved()
    onClose()
  }

  const isNarrow = window.innerWidth < 640
  const popoverWidth = Math.min(380, window.innerWidth - 24)
  const popoverMaxHeight = Math.min(560, window.innerHeight - 32)
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
        <span className="text-sm font-medium">AI 图片解释</span>
        <button onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <img
          src={selection.imageDataUrl}
          alt={selection.imageAltText}
          className="mx-auto max-h-40 rounded border border-gray-200 object-contain dark:border-gray-700"
        />
        {(selection.imageCaption || selection.imageAltText) && (
          <p className="text-xs italic text-gray-500">
            {selection.imageCaption || selection.imageAltText}
          </p>
        )}

        {!explanation && !loading && (
          <button onClick={handleExplain} className="btn-primary w-full">
            <Sparkles className="h-4 w-4" />
            解释这张图
          </button>
        )}

        {loading && !explanation && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在识图...
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {explanation && (
          <div>
            <MarkdownContent>{explanation}</MarkdownContent>
            {streaming && <Loader2 className="mt-2 h-4 w-4 animate-spin text-specula-500" />}
          </div>
        )}
      </div>

      {explanation && !streaming && (
        <div className="border-t border-gray-200 p-3 dark:border-gray-700">
          <button onClick={handleSave} className="btn-primary w-full">
            保存到划线
          </button>
        </div>
      )}
    </div>
  )
}
