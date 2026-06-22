type ChunkHandler = (chunk: string) => void
type ErrorHandler = (message: string) => void

let chunkHandler: ChunkHandler | null = null
let errorHandler: ErrorHandler | null = null

export function onExplainChunk(callback: ChunkHandler, onError?: ErrorHandler): () => void {
  chunkHandler = callback
  errorHandler = onError ?? null
  return () => {
    chunkHandler = null
    errorHandler = null
  }
}

export function emitExplainChunk(chunk: string): void {
  chunkHandler?.(chunk)
}

export function emitExplainDone(): void {
  chunkHandler = null
  errorHandler = null
}

export function emitExplainError(message: string): void {
  errorHandler?.(message)
  chunkHandler = null
  errorHandler = null
}
