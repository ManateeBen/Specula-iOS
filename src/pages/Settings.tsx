import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import {
  EXPLANATION_NEED_LABELS,
  type ExplanationNeed,
  type ExplanationTone,
} from '../types'

const NEEDS = Object.keys(EXPLANATION_NEED_LABELS) as ExplanationNeed[]

export default function Settings() {
  const settings = useSettingsStore()
  const [need, setNeed] = useState<ExplanationNeed>('not_understood')
  const [tone, setTone] = useState<ExplanationTone>('rigorous')
  const [darkMode, setDarkMode] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings.loaded) return
    setNeed(settings.defaultExplanationNeed)
    setTone(settings.explanationTone)
    setDarkMode(settings.darkMode)
  }, [settings.darkMode, settings.defaultExplanationNeed, settings.explanationTone, settings.loaded])

  const handleSave = async () => {
    await settings.update({ defaultExplanationNeed: need, explanationTone: tone, darkMode })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="h-full overflow-y-auto p-6" aria-label="settings-page">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-bold">设置</h1>
        <p className="mb-6 text-sm text-gray-500">调整阅读与讲解偏好</p>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="font-medium">默认讲解偏好</h2>
            <p className="mt-1 text-xs text-gray-500">无法判断你的需求时，以此方式开始讲解。</p>
            <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="默认讲解偏好">
              {NEEDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={item === need}
                  onClick={() => setNeed(item)}
                  className={`border px-3 py-2 text-sm font-medium ${item === need ? 'border-black bg-black text-white' : 'border-gray-300 bg-white text-gray-800'}`}
                >
                  {EXPLANATION_NEED_LABELS[item]}
                </button>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-medium">讲解语气</h2>
            <div className="mt-4 grid grid-cols-2 border border-gray-300 p-1" role="radiogroup" aria-label="讲解语气">
              {([['rigorous', '严谨'], ['casual', '轻松']] as [ExplanationTone, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={tone === value}
                  onClick={() => setTone(value)}
                  className={`px-4 py-2 text-sm font-medium ${tone === value ? 'bg-black text-white' : 'text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {darkMode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                <div><h2 className="font-medium">深色模式</h2><p className="text-xs text-gray-500">切换界面主题</p></div>
              </div>
              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                aria-label="切换深色模式"
                aria-pressed={darkMode}
                className={`relative h-6 w-11 rounded-full transition ${darkMode ? 'bg-specula-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${darkMode ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
          </section>

          <button onClick={handleSave} className="btn-primary w-full">{saved ? '已保存' : '保存设置'}</button>
        </div>
      </div>
    </div>
  )
}
