import { useEffect, lazy, Suspense } from 'react'
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

export default function App() {
  const loadSettings = useSettingsStore((s) => s.load)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

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
