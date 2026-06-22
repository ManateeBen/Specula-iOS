import type { Highlight } from '../types'

export const WEAK_POINT_COLOR_COUNT = 8

export function getWeakPointColorSlot(index: number): number {
  return ((Math.max(1, index) - 1) % WEAK_POINT_COLOR_COUNT) + 1
}

/** Stable 1-based index per quiz highlight in a chapter. */
export function buildWeakPointIndexMap(highlights: Highlight[]): Map<string, number> {
  const quiz = highlights
    .filter((h) => h.source === 'quiz')
    .sort((a, b) => {
      if (a.weakPointIndex != null && b.weakPointIndex != null) {
        return a.weakPointIndex - b.weakPointIndex
      }
      if (a.weakPointIndex != null) return -1
      if (b.weakPointIndex != null) return 1
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    })

  const map = new Map<string, number>()
  quiz.forEach((h, i) => map.set(h.id, h.weakPointIndex ?? i + 1))
  return map
}

export function getWeakPointIndex(h: Highlight, indexMap: Map<string, number>): number | null {
  if (h.source !== 'quiz') return null
  return indexMap.get(h.id) ?? null
}

/** Sidebar Tailwind classes per color slot (1–8). */
export const WEAK_POINT_SIDEBAR: Record<
  number,
  { border: string; badge: string; topic: string; quote: string }
> = {
  1: {
    border: 'border-l-orange-400',
    badge: 'bg-orange-600 text-orange-50',
    topic: 'text-orange-700 dark:text-orange-400',
    quote: 'border-l-orange-400 text-orange-800 dark:text-orange-300',
  },
  2: {
    border: 'border-l-rose-400',
    badge: 'bg-rose-600 text-rose-50',
    topic: 'text-rose-700 dark:text-rose-400',
    quote: 'border-l-rose-400 text-rose-800 dark:text-rose-300',
  },
  3: {
    border: 'border-l-blue-400',
    badge: 'bg-blue-600 text-blue-50',
    topic: 'text-blue-700 dark:text-blue-400',
    quote: 'border-l-blue-400 text-blue-800 dark:text-blue-300',
  },
  4: {
    border: 'border-l-emerald-400',
    badge: 'bg-emerald-600 text-emerald-50',
    topic: 'text-emerald-700 dark:text-emerald-400',
    quote: 'border-l-emerald-400 text-emerald-800 dark:text-emerald-300',
  },
  5: {
    border: 'border-l-violet-400',
    badge: 'bg-violet-600 text-violet-50',
    topic: 'text-violet-700 dark:text-violet-400',
    quote: 'border-l-violet-400 text-violet-800 dark:text-violet-300',
  },
  6: {
    border: 'border-l-cyan-400',
    badge: 'bg-cyan-600 text-cyan-50',
    topic: 'text-cyan-700 dark:text-cyan-400',
    quote: 'border-l-cyan-400 text-cyan-800 dark:text-cyan-300',
  },
  7: {
    border: 'border-l-fuchsia-400',
    badge: 'bg-fuchsia-600 text-fuchsia-50',
    topic: 'text-fuchsia-700 dark:text-fuchsia-400',
    quote: 'border-l-fuchsia-400 text-fuchsia-800 dark:text-fuchsia-300',
  },
  8: {
    border: 'border-l-lime-500',
    badge: 'bg-lime-600 text-lime-50',
    topic: 'text-lime-700 dark:text-lime-400',
    quote: 'border-l-lime-500 text-lime-800 dark:text-lime-300',
  },
}

export function getWeakPointSidebarStyle(index: number) {
  return WEAK_POINT_SIDEBAR[getWeakPointColorSlot(index)]
}

export function sortHighlightsForDisplay(
  highlights: Highlight[],
  indexMap: Map<string, number>
): Highlight[] {
  return [...highlights].sort((a, b) => {
    const aQuiz = a.source === 'quiz'
    const bQuiz = b.source === 'quiz'
    if (aQuiz && bQuiz) {
      return (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0)
    }
    if (aQuiz !== bQuiz) return aQuiz ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  })
}
