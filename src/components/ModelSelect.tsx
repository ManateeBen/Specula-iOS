import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

interface Props {
  value: string
  onChange: (model: string) => void
  models: string[]
  loading: boolean
  error?: string
  onRefresh: () => void
  disabled?: boolean
  canFetch: boolean
}

export default function ModelSelect({
  value,
  onChange,
  models,
  loading,
  error,
  onRefresh,
  disabled,
  canFetch,
}: Props) {
  const [manual, setManual] = useState(false)

  if (manual || models.length === 0) {
    return (
      <div className="space-y-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="input"
          placeholder="输入模型 ID"
        />
        {models.length > 0 && (
          <button type="button" onClick={() => setManual(false)} className="text-xs text-specula-600 hover:underline">
            改用下拉选择
          </button>
        )}
        {error && <p className="text-xs text-amber-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading}
          className="input flex-1"
        >
          {!models.includes(value) && value && (
            <option value={value}>{value}（当前）</option>
          )}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!canFetch || loading}
          className="btn-secondary shrink-0 px-2"
          title="刷新模型列表"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>
      <button type="button" onClick={() => setManual(true)} className="text-xs text-gray-500 hover:underline">
        手动输入模型名
      </button>
      {error && <p className="text-xs text-amber-600">{error}</p>}
    </div>
  )
}
