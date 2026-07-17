import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import type { Chapter, ImageSelectionInfo } from '../../types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  data: Uint8Array
  chapters: Chapter[]
  initialPosition?: string
  jumpToChapterId?: string | null
  onJumpComplete?: () => void
  onProgress: (chapterId: string | null, position: string) => void
  onTextSelect: (text: string, context: string, rect: DOMRect) => void
  onImageSelect?: (info: ImageSelectionInfo) => void
}

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>
type RenderTask = ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']>
type TextLayerRenderTask = ReturnType<typeof pdfjs.renderTextLayer>

function parsePage(value?: string): number {
  const page = parseInt(value || '1', 10)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function clampPage(page: number, total: number): number {
  return Math.min(Math.max(page, 1), Math.max(total, 1))
}

function chapterForPage(chapters: Chapter[], pageNum: number): Chapter | null {
  return (
    chapters.find((chapter) => {
      const start = parsePage(chapter.startRef)
      const end = parsePage(chapter.endRef)
      return pageNum >= start && pageNum <= end
    }) || null
  )
}

function getReadableContainerWidth(container: HTMLElement | null): number {
  const measured = container?.clientWidth || container?.getBoundingClientRect().width || 0
  if (measured > 0) return measured
  if (typeof window !== 'undefined' && window.innerWidth > 0) return window.innerWidth
  return 390
}

function getReadableContainerHeight(container: HTMLElement | null): number {
  const measured = container?.clientHeight || container?.getBoundingClientRect().height || 0
  if (measured > 0) return measured
  if (typeof window !== 'undefined' && window.innerHeight > 0) return window.innerHeight
  return 720
}

export default function PdfReader({
  data,
  chapters,
  initialPosition,
  jumpToChapterId,
  onJumpComplete,
  onProgress,
  onTextSelect,
  onImageSelect,
}: Props) {
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [pageNum, setPageNum] = useState(parsePage(initialPosition))
  const [loading, setLoading] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window === 'undefined' ? 390 : Math.max(window.innerWidth, 390)
  )
  const lastJumpRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSelectionKeyRef = useRef('')

  const totalPages = doc?.numPages || 0
  const currentChapter = useMemo(() => chapterForPage(chapters, pageNum), [chapters, pageNum])

  useEffect(() => {
    let cancelled = false
    const loadingTask = pdfjs.getDocument({
      data: data.slice(),
      disableFontFace: true,
      disableWorker: true,
      useSystemFonts: true,
    } as Parameters<typeof pdfjs.getDocument>[0])

    setLoading(true)
    setError('')
    setDoc(null)

    loadingTask.promise
      .then((loadedDoc) => {
        if (cancelled) {
          void loadedDoc.destroy()
          return
        }
        setDoc(loadedDoc)
        setPageNum((page) => clampPage(page, loadedDoc.numPages))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'PDF 加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
  }, [data])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = () => setContainerWidth(getReadableContainerWidth(el))
    update()
    const frame = window.requestAnimationFrame(update)

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(update)
      observer.observe(el)
      window.addEventListener('resize', update)
      return () => {
        window.cancelAnimationFrame(frame)
        window.removeEventListener('resize', update)
        observer.disconnect()
      }
    }

    window.addEventListener('resize', update)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    if (!doc || !containerWidth) return

    let cancelled = false
    let renderTask: RenderTask | null = null
    let textLayerTask: TextLayerRenderTask | null = null

    const render = async () => {
      setRendering(true)
      setError('')

      try {
        const page = await doc.getPage(pageNum)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const readableWidth = getReadableContainerWidth(containerRef.current)
        const readableHeight = getReadableContainerHeight(containerRef.current)
        const availableWidth = Math.max((readableWidth || containerWidth) - 32, 280)
        const verticalChrome = readableWidth < 768 ? 190 : 96
        const availableHeight = Math.max(readableHeight - verticalChrome, 360)
        const scale = Math.min(
          availableWidth / baseViewport.width,
          availableHeight / baseViewport.height
        ) * zoom
        const viewport = page.getViewport({ scale })

        const canvas = canvasRef.current
        const textLayer = textLayerRef.current
        if (!canvas || !textLayer) return

        const outputScale = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        textLayer.style.width = `${viewport.width}px`
        textLayer.style.height = `${viewport.height}px`
        textLayer.style.setProperty('--scale-factor', String(viewport.scale))
        textLayer.replaceChildren()

        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas unavailable')
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, canvas.width, canvas.height)

        renderTask = page.render({
          canvasContext: context,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          viewport,
        })
        await renderTask.promise
        if (cancelled) return

        const textContent = await page.getTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        })
        if (cancelled) return

        textLayerTask = pdfjs.renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
          textDivs: [],
          textContentItemsStr: [],
        })
        await textLayerTask.promise
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === 'RenderingCancelledException')) {
          setError(err instanceof Error ? err.message : 'PDF 渲染失败')
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }

    void render()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayerTask?.cancel()
    }
  }, [doc, pageNum, containerWidth, zoom])

  useEffect(() => {
    if (!doc) return
    const chapter = chapterForPage(chapters, pageNum)
    onProgress(chapter?.id || null, String(pageNum))
  }, [chapters, doc, onProgress, pageNum])

  const jumpToPage = useCallback(
    (page: number) => {
      if (!doc) return
      setPageNum(clampPage(page, doc.numPages))
      containerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    },
    [doc]
  )

  const jumpToChapter = useCallback(
    (chapterId: string) => {
      const ch = chapters.find((c) => c.id === chapterId)
      if (!ch) return
      jumpToPage(parsePage(ch.startRef))
    },
    [chapters, jumpToPage]
  )

  const changeZoom = useCallback((delta: number) => {
    setZoom((current) => Math.min(1.8, Math.max(0.8, Math.round((current + delta) * 10) / 10)))
  }, [])

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

  const emitSelection = useCallback(() => {
    const sel = window.getSelection()
    const textLayer = textLayerRef.current
    if (!sel || sel.isCollapsed || !textLayer) return
    const anchorInLayer = sel.anchorNode ? textLayer.contains(sel.anchorNode) : false
    const focusInLayer = sel.focusNode ? textLayer.contains(sel.focusNode) : false
    if (!anchorInLayer && !focusInLayer) return
    const text = sel.toString().trim()
    if (!text) return
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const selectionKey = `${text}|${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}|${Math.round(rect.height)}`
    if (selectionKey === lastSelectionKeyRef.current) return
    lastSelectionKeyRef.current = selectionKey
    const context = textLayer.textContent?.slice(0, 1000) || ''
    onTextSelect(text, context, rect)
  }, [onTextSelect])

  const scheduleSelection = useCallback((delay = 500) => {
    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
    selectionTimerRef.current = setTimeout(emitSelection, delay)
  }, [emitSelection])

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      const textLayer = textLayerRef.current
      if (!selection || selection.isCollapsed || !textLayer) {
        if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
        lastSelectionKeyRef.current = ''
        return
      }
      const belongsToPage =
        (selection.anchorNode && textLayer.contains(selection.anchorNode)) ||
        (selection.focusNode && textLayer.contains(selection.focusNode))
      if (belongsToPage) scheduleSelection(650)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
    }
  }, [scheduleSelection])

  useEffect(() => {
    lastSelectionKeyRef.current = ''
  }, [pageNum, zoom])

  const handleExplainCurrentPage = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !onImageSelect) return

    const rect = canvas.getBoundingClientRect()
    const chapterTitle = currentChapter?.title || `Page ${pageNum}`
    onImageSelect({
      imageDataUrl: canvas.toDataURL('image/png'),
      imageAltText: `PDF page ${pageNum}`,
      imageCaption: `PDF 第 ${pageNum} 页`,
      imageContext: `${chapterTitle}\n${textLayerRef.current?.textContent?.slice(0, 1200) || ''}`,
      rect,
    })
  }, [currentChapter?.title, onImageSelect, pageNum])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-gray-500">加载 PDF...</div>
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-red-500">
        PDF 加载失败：{error}
      </div>
    )
  }

  return (
    <div className="relative h-full bg-gray-100 dark:bg-gray-950">
      <div
        ref={containerRef}
        className="pdf-viewer-container h-full overflow-auto px-4 py-4"
        onMouseUp={() => scheduleSelection(120)}
        onTouchEnd={() => scheduleSelection(650)}
      >
        <div className="mx-auto w-fit">
          <div className="relative bg-white shadow-sm">
            <canvas ref={canvasRef} className="block" />
            <div
              ref={textLayerRef}
              className="pdf-text-layer absolute left-0 top-0 overflow-hidden"
              aria-label={`Page ${pageNum}`}
            />
          </div>
        </div>
        {rendering && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
            <div className="rounded-full bg-gray-900/70 px-3 py-1 text-xs text-white">渲染中...</div>
          </div>
        )}
      </div>

      <div className="reader-page-bar reader-page-bar--pdf absolute inset-x-0 bottom-3 safe-bottom">
        <button
          className="reader-page-button reader-page-button--compact"
          disabled={zoom <= 0.8}
          type="button"
          onClick={() => changeZoom(-0.1)}
        >
          -
        </button>
        <button
          className="reader-page-button"
          disabled={pageNum <= 1}
          type="button"
          onClick={() => jumpToPage(pageNum - 1)}
        >
          上一页
        </button>
        <div className="reader-page-button reader-page-button--toc">
          {pageNum}/{totalPages || '-'}
        </div>
        <button
          className="reader-page-button"
          disabled={!totalPages || pageNum >= totalPages}
          type="button"
          onClick={() => jumpToPage(pageNum + 1)}
        >
          下一页
        </button>
        <button
          className="reader-page-button reader-page-button--compact"
          disabled={zoom >= 1.8}
          type="button"
          onClick={() => changeZoom(0.1)}
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>

      {onImageSelect && (
        <button
          className="pdf-image-explain-button"
          type="button"
          onClick={handleExplainCurrentPage}
          aria-label="pdf-image-explain"
        >
          AI识图
        </button>
      )}

      {currentChapter && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <div className="max-w-[80%] truncate rounded-full bg-white/90 px-3 py-1 text-xs text-gray-600 shadow-sm dark:bg-gray-900/90 dark:text-gray-300">
            {currentChapter.title}
          </div>
        </div>
      )}
    </div>
  )
}
