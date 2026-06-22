import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Worker, Viewer } from '@react-pdf-viewer/core'
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import '@react-pdf-viewer/core/lib/styles/index.css'
import '@react-pdf-viewer/default-layout/lib/styles/index.css'
import type { Chapter } from '../../types'

interface Props {
  data: Uint8Array
  chapters: Chapter[]
  initialPosition?: string
  jumpToChapterId?: string | null
  onJumpComplete?: () => void
  onProgress: (chapterId: string | null, position: string) => void
  onTextSelect: (text: string, context: string, rect: DOMRect) => void
}

export default function PdfReader({
  data,
  chapters,
  initialPosition,
  jumpToChapterId,
  onJumpComplete,
  onProgress,
  onTextSelect,
}: Props) {
  const [landingPage, setLandingPage] = useState(parseInt(initialPosition || '1', 10) - 1)
  const [viewerKey, setViewerKey] = useState(0)
  const lastJumpRef = useRef<string | null>(null)

  const defaultLayoutPluginInstance = useMemo(() => defaultLayoutPlugin(), [])
  const fileData = useMemo(() => data.slice(), [data, viewerKey])

  const jumpToChapter = useCallback(
    (chapterId: string) => {
      const ch = chapters.find((c) => c.id === chapterId)
      if (!ch) return
      const page = parseInt(ch.startRef, 10) - 1
      setLandingPage(page)
      setViewerKey((k) => k + 1)
      onProgress(chapterId, ch.startRef)
    },
    [chapters, onProgress]
  )

  useEffect(() => {
    if (!jumpToChapterId) {
      lastJumpRef.current = null
      return
    }
    if (jumpToChapterId === lastJumpRef.current) return
    lastJumpRef.current = jumpToChapterId
    jumpToChapter(jumpToChapterId)
    onJumpComplete?.()
  }, [jumpToChapterId, jumpToChapter, onJumpComplete])

  const handlePageChange = useCallback(
    (e: { currentPage: number }) => {
      const pageNum = e.currentPage + 1
      const chapter = chapters.find(
        (c) => pageNum >= parseInt(c.startRef, 10) && pageNum <= parseInt(c.endRef, 10)
      )
      onProgress(chapter?.id || null, String(pageNum))
    },
    [chapters, onProgress]
  )

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const text = sel.toString().trim()
    if (!text) return
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const context = range.commonAncestorContainer.textContent?.slice(0, 500) || ''
    onTextSelect(text, context, rect)
  }, [onTextSelect])

  return (
    <div className="flex h-full flex-col" onMouseUp={handleMouseUp}>
      <div className="pdf-viewer-container flex-1 overflow-hidden">
        <Worker workerUrl={workerUrl}>
          <Viewer
            key={viewerKey}
            fileUrl={fileData}
            plugins={[defaultLayoutPluginInstance]}
            initialPage={landingPage}
            onPageChange={handlePageChange}
          />
        </Worker>
      </div>
    </div>
  )
}
