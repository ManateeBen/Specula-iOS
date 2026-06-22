import type { TeachingMode } from '../types'
import { TEACHING_MODE_LABELS, TEACHING_MODE_DESCRIPTIONS } from '../types'

interface Props {
  value: TeachingMode
  onChange: (mode: TeachingMode) => void
  compact?: boolean
}

const modes: TeachingMode[] = [
  'direct',
  'socratic',
  'feynman',
  'analogy',
  'case',
  'contrast',
  'story',
  'structure',
  'summary',
  'practice',
  'history',
]

export default function TeachingModePicker({ value, onChange, compact }: Props) {
  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TeachingMode)}
        className="input py-1.5 text-xs"
      >
        {modes.map((m) => (
          <option key={m} value={m}>
            {TEACHING_MODE_LABELS[m]}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`rounded-lg border p-3 text-left text-sm transition ${
            value === mode
              ? 'border-specula-500 bg-specula-50 dark:bg-specula-900/20'
              : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
          }`}
        >
          <div className="font-medium">{TEACHING_MODE_LABELS[mode]}</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {TEACHING_MODE_DESCRIPTIONS[mode]}
          </div>
        </button>
      ))}
    </div>
  )
}
