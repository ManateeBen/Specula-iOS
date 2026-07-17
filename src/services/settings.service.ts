import { Preferences } from '@capacitor/preferences'
import type { AppSettings, ExplanationTone, TeachingMode } from '../types'

const BUILTIN_TEXT_API_KEY = import.meta.env.VITE_SPECULA_TEXT_API_KEY || ''
const BUILTIN_VISION_API_KEY = import.meta.env.VITE_SPECULA_VISION_API_KEY || ''

const KEYS = {
  apiKey: 'apiKey',
  baseURL: 'baseURL',
  model: 'model',
  defaultTeachingMode: 'defaultTeachingMode',
  explanationTone: 'explanationTone',
  darkMode: 'darkMode',
  visionApiKey: 'visionApiKey',
  visionBaseURL: 'visionBaseURL',
  visionModel: 'visionModel',
} as const

const DEFAULTS: AppSettings = {
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  defaultTeachingMode: 'direct',
  explanationTone: 'rigorous',
  darkMode: false,
  visionApiKey: '',
  visionBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  visionModel: 'qwen-vl-max',
}

async function getPref(key: string, fallback: string): Promise<string> {
  const { value } = await Preferences.get({ key })
  return value ?? fallback
}

async function setPref(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value })
}

export async function getSettings(): Promise<AppSettings> {
  const [defaultTeachingMode, explanationTone, darkMode] = await Promise.all([
    getPref(KEYS.defaultTeachingMode, DEFAULTS.defaultTeachingMode),
    getPref(KEYS.explanationTone, DEFAULTS.explanationTone),
    getPref(KEYS.darkMode, String(DEFAULTS.darkMode)),
  ])

  return {
    ...DEFAULTS,
    defaultTeachingMode: defaultTeachingMode as TeachingMode,
    explanationTone: explanationTone as ExplanationTone,
    darkMode: darkMode === 'true',
  }
}

export async function setSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const tasks: Promise<void>[] = []
  if (partial.apiKey !== undefined) tasks.push(setPref(KEYS.apiKey, partial.apiKey))
  if (partial.baseURL !== undefined) tasks.push(setPref(KEYS.baseURL, partial.baseURL))
  if (partial.model !== undefined) tasks.push(setPref(KEYS.model, partial.model))
  if (partial.defaultTeachingMode !== undefined) {
    tasks.push(setPref(KEYS.defaultTeachingMode, partial.defaultTeachingMode))
  }
  if (partial.explanationTone !== undefined) tasks.push(setPref(KEYS.explanationTone, partial.explanationTone))
  if (partial.darkMode !== undefined) tasks.push(setPref(KEYS.darkMode, String(partial.darkMode)))
  if (partial.visionApiKey !== undefined) tasks.push(setPref(KEYS.visionApiKey, partial.visionApiKey))
  if (partial.visionBaseURL !== undefined) tasks.push(setPref(KEYS.visionBaseURL, partial.visionBaseURL))
  if (partial.visionModel !== undefined) tasks.push(setPref(KEYS.visionModel, partial.visionModel))
  await Promise.all(tasks)
  return getSettings()
}

export async function getTextConfig(): Promise<{ apiKey: string; baseURL: string; model: string }> {
  return {
    apiKey: BUILTIN_TEXT_API_KEY,
    baseURL: DEFAULTS.baseURL,
    model: DEFAULTS.model,
  }
}

export async function getVisionConfig(): Promise<{ apiKey: string; baseURL: string; model: string }> {
  return {
    apiKey: BUILTIN_VISION_API_KEY,
    baseURL: DEFAULTS.visionBaseURL,
    model: DEFAULTS.visionModel,
  }
}

export async function getDefaultTeachingMode(): Promise<TeachingMode> {
  const s = await getSettings()
  return s.defaultTeachingMode
}
