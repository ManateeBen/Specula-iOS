import { create } from 'zustand'
import type { AppSettings, ExplanationTone, TeachingMode } from '../types'

interface SettingsState extends AppSettings {
  loaded: boolean
  load: () => Promise<void>
  update: (partial: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  defaultTeachingMode: 'direct' as TeachingMode,
  explanationTone: 'rigorous' as ExplanationTone,
  darkMode: false,
  readingMode: 'scroll',
  visionApiKey: '',
  visionBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  visionModel: 'qwen-vl-max',
  loaded: false,
  load: async () => {
    const settings = await window.specula.settings.get()
    set({ ...settings, loaded: true })
    if (settings.darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
  update: async (partial) => {
    const settings = await window.specula.settings.set(partial)
    set(settings)
    if (settings.darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
}))
