import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, BookOpen, Trash2, FileText } from 'lucide-react'
import type { Book } from '../types'

export default function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadBooks = async () => {
    setLoading(true)
    const list = await window.specula.books.list()
    setBooks(list)

    const coverMap: Record<string, string | null> = {}
    for (const book of list) {
      coverMap[book.id] = await window.specula.books.getCoverUrl(book.coverPath)
    }
    setCovers(coverMap)
    setLoading(false)
  }

  useEffect(() => {
    loadBooks()
    window.addEventListener('specula:library-updated', loadBooks)
    return () => window.removeEventListener('specula:library-updated', loadBooks)
  }, [])

  const handleImport = async () => {
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const book = await window.specula.books.import()
      if (book) {
        await loadBooks()
        if (book.format === 'pdf' && book.pdfTextStatus !== 'text') {
          setNotice(book.pdfAiUnsupportedReason || '该 PDF 暂不支持 AI 功能，开发中')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入书籍失败')
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (confirm('确定删除这本书吗？')) {
      try {
        await window.specula.books.delete(id)
        await loadBooks()
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除书籍失败')
      }
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6" aria-label="library-page">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">我的书库</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              导入 PDF 或 EPUB 电子书，开启 AI 辅助阅读
            </p>
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="btn-primary"
            aria-label="import-book"
          >
            <Plus className="h-4 w-4" />
            {importing ? '导入中...' : '导入书籍'}
          </button>
        </div>

        {error && (
          <div className="card mb-4 border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}
        {notice && (
          <div className="card mb-4 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-gray-500">加载中...</div>
        ) : books.length === 0 ? (
          <div
            onClick={handleImport}
            className="card flex cursor-pointer flex-col items-center justify-center py-20 transition hover:border-specula-300"
          >
            <BookOpen className="mb-4 h-16 w-16 text-gray-300" />
            <p className="text-lg font-medium text-gray-600 dark:text-gray-400">书库为空</p>
            <p className="mt-1 text-sm text-gray-500">点击导入 PDF 或 EPUB 电子书</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {books.map((book) => (
              <Link
                key={book.id}
                to={`/reader/${book.id}`}
                aria-label={`book-${book.title}`}
                className="card group overflow-hidden transition hover:shadow-md"
              >
                <div className="relative aspect-[3/4] bg-gray-100 dark:bg-gray-800">
                  {covers[book.id] ? (
                    <img
                      src={covers[book.id]!}
                      alt={book.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <FileText className="h-12 w-12 text-gray-300" />
                    </div>
                  )}
                  <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs uppercase text-white">
                    {book.format}
                  </span>
                  <button
                    onClick={(e) => handleDelete(book.id, e)}
                    className="absolute left-2 top-2 rounded bg-red-500/80 p-2 text-white opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
                    aria-label="删除书籍"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-2 text-sm font-medium">{book.title}</h3>
                  {book.author && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{book.author}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
