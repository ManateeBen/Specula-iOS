import type { QuizPreset } from '../types'
import { QUIZ_PRESET_LABELS } from '../types'

export interface QuizConfig {
  questionCount: number
  quizPreset: QuizPreset
}

interface Props {
  config: QuizConfig
  onChange: (config: QuizConfig) => void
  existingQuestionCount?: number
  onStart: () => void
  onContinue?: () => void
  starting?: boolean
}

const PRESETS: QuizPreset[] = [
  'choice_only',
  'choice_multi',
  'choice_fill',
  'choice_short',
  'all',
]

export function clampQuizCount(n: number): number {
  return Math.min(20, Math.max(1, Math.round(n) || 1))
}

export default function QuizSetupForm({
  config,
  onChange,
  existingQuestionCount,
  onStart,
  onContinue,
  starting,
}: Props) {
  return (
    <div className="card p-6">
      {existingQuestionCount != null && existingQuestionCount > 0 && (
        <div className="mb-5 rounded-lg border border-specula-200 bg-specula-50 p-4 dark:border-specula-800 dark:bg-specula-900/20">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            本章已有测验（{existingQuestionCount} 题），可继续作答或按下方配置重新生成。
          </p>
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              disabled={starting}
              className="btn-secondary mt-3"
            >
              继续上次测验
            </button>
          )}
        </div>
      )}

      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium">题目数量</label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={20}
            value={config.questionCount}
            onChange={(e) =>
              onChange({ ...config, questionCount: clampQuizCount(Number(e.target.value)) })
            }
            className="flex-1"
          />
          <input
            type="number"
            min={1}
            max={20}
            value={config.questionCount}
            onChange={(e) =>
              onChange({ ...config, questionCount: clampQuizCount(Number(e.target.value)) })
            }
            className="input w-20 text-center"
          />
          <span className="text-sm text-gray-500">题（最多 20）</span>
        </div>
      </div>

      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium">题型预设</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange({ ...config, quizPreset: preset })}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                config.quizPreset === preset
                  ? 'border-specula-500 bg-specula-50 text-specula-800 dark:border-specula-400 dark:bg-specula-900/30 dark:text-specula-300'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
              }`}
            >
              {QUIZ_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      </div>

      <button type="button" onClick={onStart} disabled={starting} className="btn-primary w-full">
        {starting ? '准备中...' : '开始生成测验'}
      </button>
    </div>
  )
}
