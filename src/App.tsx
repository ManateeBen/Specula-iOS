import { useEffect, lazy, Suspense } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './pages/Library'
import { useSettingsStore } from './stores/settingsStore'

// Lazy-load heavier routes so the PDF/AI bundles aren't pulled into the initial
// load. The library stays eager since it's the landing page.
const Reader = lazy(() => import('./pages/Reader'))
const Quiz = lazy(() => import('./pages/Quiz'))
const Review = lazy(() => import('./pages/Review'))
const QuizHistory = lazy(() => import('./pages/QuizHistory'))
const Settings = lazy(() => import('./pages/Settings'))

function RouteFallback() {
  return <div className="flex h-full items-center justify-center text-gray-500">加载中...</div>
}

async function handleExternalImport(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'specula:' || parsed.hostname !== 'import') return

  const filePath = parsed.searchParams.get('path')
  if (!filePath) return

  const originalName = parsed.searchParams.get('name') || undefined
  const book = await window.specula.books.importFromStoragePath(filePath, originalName)
  window.dispatchEvent(new CustomEvent('specula:library-updated', { detail: book }))
  if (book) {
    window.location.hash = `/reader/${book.id}`
  }
}

export default function App() {
  const loadSettings = useSettingsStore((s) => s.load)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const handledUrls = new Set<string>()
    const consumeUrl = async (url?: string) => {
      if (!url || handledUrls.has(url)) return
      handledUrls.add(url)
      try {
        await handleExternalImport(url)
      } catch (err) {
        console.error('Failed to import shared document', err)
      }
    }

    let removeListener: (() => void) | undefined
    CapacitorApp.addListener('appUrlOpen', (event) => {
      consumeUrl(event.url)
    }).then((handle) => {
      removeListener = () => handle.remove()
    })
    CapacitorApp.getLaunchUrl().then((event) => consumeUrl(event?.url))

    return () => {
      removeListener?.()
    }
  }, [])

  return (
    <HashRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Library />} />
            <Route path="reader/:bookId" element={<Reader />} />
            <Route path="quiz/:bookId/:chapterId" element={<Quiz />} />
            <Route path="review/:bookId/:chapterId" element={<Review />} />
            <Route path="quiz-history/:bookId/:chapterId" element={<QuizHistory />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
