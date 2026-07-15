import { Link, Outlet, useLocation } from 'react-router-dom'
import { BookOpen, Settings, Library } from 'lucide-react'

const navItems = [
  { to: '/', label: '书库', icon: Library },
  { to: '/settings', label: '设置', icon: Settings },
]

export default function Layout() {
  const location = useLocation()
  const isReader = location.pathname.startsWith('/reader') || location.pathname.startsWith('/quick-browse')

  if (isReader) {
    return <Outlet />
  }

  return (
    <div className="flex h-full flex-col safe-top safe-bottom">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-900 md:h-14">
        <Link to="/" className="flex items-center gap-2 font-semibold text-specula-700 dark:text-specula-400">
          <BookOpen className="h-6 w-6" />
          Specula
        </Link>
        <nav className="hidden gap-1 md:flex">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to
            return (
              <Link
                key={to}
                to={to}
                aria-label={to === '/' ? 'library-tab' : 'settings-tab'}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                  active
                    ? 'bg-specula-50 text-specula-700 dark:bg-specula-900/30 dark:text-specula-400'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      <nav className="flex shrink-0 border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {navItems.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to
          return (
            <Link
              key={to}
              to={to}
              aria-label={to === '/' ? 'library-tab' : 'settings-tab'}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition ${
                active
                  ? 'text-specula-600 dark:text-specula-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
