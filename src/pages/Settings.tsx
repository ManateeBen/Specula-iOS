import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import TeachingModePicker from '../components/TeachingModePicker'
import { useSettingsStore } from '../stores/settingsStore'
import type { TeachingMode } from '../types'

export default function Settings() {
  const settings = useSettingsStore()
  const [teachingMode, setTeachingMode] = useState<TeachingMode>('direct')
  const [darkMode, setDarkMode] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings.loaded) return
    setTeachingMode(settings.defaultTeachingMode)
    setDarkMode(settings.darkMode)
  }, [settings.loaded, settings.defaultTeachingMode, settings.darkMode])

  const handleSave = async () => {
    await settings.update({ defaultTeachingMode: teachingMode, darkMode })
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
            <h2 className="mb-4 font-medium">默认教学方式</h2>
            <TeachingModePicker value={teachingMode} onChange={setTeachingMode} />
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {darkMode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                <div>
                  <h2 className="font-medium">深色模式</h2>
                  <p className="text-xs text-gray-500">切换界面主题</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                aria-label="切换深色模式"
                aria-pressed={darkMode}
                className={`relative h-6 w-11 rounded-full transition ${
                  darkMode ? 'bg-specula-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                    darkMode ? 'left-5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          </section>

          <button onClick={handleSave} className="btn-primary w-full">
            {saved ? '已保存' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}
