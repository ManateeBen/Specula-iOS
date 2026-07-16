import { Link, Outlet, useLocation } from 'react-router-dom'
import { BookOpen, Settings, Library } from 'lucide-react'

const navItems = [
  { to: '/', label: 'LIBRARY', icon: Library },
  { to: '/settings', label: 'SETTINGS', icon: Settings },
]

export default function Layout() {
  const location = useLocation()
  const isReader = location.pathname.startsWith('/reader') || location.pathname.startsWith('/quick-browse')
  const isLibrary = location.pathname === '/'

  if (isReader) return <Outlet />

  return (
    <div className={`flex h-full flex-col safe-top safe-bottom ${isLibrary ? 'records-shell' : ''}`}>
      {!isLibrary && (
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-900 md:h-14">
          <Link to="/" className="flex items-center gap-2 font-semibold text-specula-700 dark:text-specula-400">
            <BookOpen className="h-6 w-6" />
            Specula
          </Link>
        </header>
      )}

      <main className="flex-1 overflow-hidden"><Outlet /></main>

      <nav className={isLibrary ? 'records-tabs' : 'flex shrink-0 border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {navItems.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to
          return (
            <Link key={to} to={to} aria-label={to === '/' ? 'library-tab' : 'settings-tab'} className={isLibrary ? (active ? 'is-active' : '') : `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition ${active ? 'text-specula-600' : 'text-gray-500'}`}>
              {!isLibrary && <Icon className="h-5 w-5" />}
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
