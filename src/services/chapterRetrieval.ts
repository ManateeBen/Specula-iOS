export interface ChapterChunk {
  id: string
  startOffset: number
  text: string
}

export interface WrongItemForRetrieval {
  questionId: string
  question?: string
  correctAnswer?: string
  userAnswer?: string
  feedback?: string
}

// Normalize for keyword overlap: keep CJK, letters, digits; fold case.
function normalizeForMatch(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    let c = ch
    if (code >= 0xff01 && code <= 0xff5e) c = String.fromCharCode(code - 0xfee0)
    else if (code === 0x3000) c = ' '
    c = c.toLowerCase()
    if (/[a-z0-9\u4e00-\u9fff\u3400-\u4dbf]/.test(c)) out += c
  }
  return out
}

// Extract overlapping keywords (2+ char runs) from query for scoring.
function extractKeywords(query: string): string[] {
  const norm = normalizeForMatch(query)
  const keywords = new Set<string>()
  // CJK runs of 2-6 chars
  const cjk = norm.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,6}/g) || []
  for (const w of cjk) keywords.add(w)
  // Latin/number tokens
  const latin = norm.match(/[a-z0-9]{2,}/g) || []
  for (const w of latin) keywords.add(w)
  return [...keywords]
}

export function splitChapterIntoChunks(text: string): ChapterChunk[] {
  if (!text.trim()) return []

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks: ChapterChunk[] = []
  let offset = 0
  let buf = ''
  let bufStart = 0
  const MIN = 80
  const MAX = 800

  const flush = () => {
    const t = buf.trim()
    if (t.length >= MIN) {
      chunks.push({ id: `c-${chunks.length}`, startOffset: bufStart, text: t })
    }
    buf = ''
  }

  for (const para of paragraphs) {
    const idx = text.indexOf(para, offset)
    if (idx >= 0) offset = idx

    if (!buf) bufStart = offset

    if (buf && buf.length + para.length > MAX) {
      flush()
      bufStart = offset
    }

    buf += (buf ? '\n\n' : '') + para
    offset += para.length

    if (buf.length >= MAX) flush()
  }
  flush()

  // Very short chapters: one chunk from full text.
  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push({ id: 'c-0', startOffset: 0, text: text.trim() })
  }

  return chunks
}

export function buildRetrievalQuery(item: WrongItemForRetrieval): string {
  return [item.question, item.userAnswer, item.correctAnswer, item.feedback]
    .filter(Boolean)
    .join(' ')
}

export function scoreChunk(query: string, chunk: ChapterChunk): number {
  const keywords = extractKeywords(query)
  if (keywords.length === 0) return 0

  const chunkNorm = normalizeForMatch(chunk.text)
  let score = 0
  for (const kw of keywords) {
    if (chunkNorm.includes(kw)) score += kw.length
  }

  // Bonus for longer contiguous overlap between query and chunk.
  const queryNorm = normalizeForMatch(query)
  if (queryNorm.length >= 6) {
    for (let len = Math.min(20, queryNorm.length); len >= 4; len--) {
      for (let i = 0; i <= queryNorm.length - len; i++) {
        const sub = queryNorm.slice(i, i + len)
        if (chunkNorm.includes(sub)) {
          score += len * 2
          break
        }
      }
    }
  }

  return score
}

export function retrieveTopChunks(
  chapterText: string,
  wrongItems: WrongItemForRetrieval[],
  k = 3
): ChapterChunk[] {
  const allChunks = splitChapterIntoChunks(chapterText)
  if (allChunks.length === 0) return []

  const scored = new Map<string, { chunk: ChapterChunk; score: number }>()

  for (const item of wrongItems) {
    const query = buildRetrievalQuery(item)
    const ranked = allChunks
      .map((chunk) => ({ chunk, score: scoreChunk(query, chunk) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)

    for (const { chunk, score } of ranked) {
      const prev = scored.get(chunk.id)
      if (!prev || score > prev.score) scored.set(chunk.id, { chunk, score })
    }
  }

  // If nothing matched, return first chunks as fallback context.
  if (scored.size === 0) {
    return allChunks.slice(0, Math.min(k, allChunks.length))
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .map((s) => s.chunk)
}
