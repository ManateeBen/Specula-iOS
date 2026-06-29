import { Preferences } from '@capacitor/preferences'
import type { AppSettings, TeachingMode } from '../types'

const BUILTIN_TEXT_API_KEY = import.meta.env.VITE_SPECULA_TEXT_API_KEY || ''
const BUILTIN_VISION_API_KEY = import.meta.env.VITE_SPECULA_VISION_API_KEY || ''

const KEYS = {
  apiKey: 'apiKey',
  baseURL: 'baseURL',
  model: 'model',
  defaultTeachingMode: 'defaultTeachingMode',
  darkMode: 'darkMode',
  visionApiKey: 'visionApiKey',
  visionBaseURL: 'visionBaseURL',
  visionModel: 'visionModel',
} as const

const DEFAULTS: AppSettings = {
  apiKey: BUILTIN_TEXT_API_KEY,
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  defaultTeachingMode: 'direct',
  darkMode: false,
  visionApiKey: BUILTIN_VISION_API_KEY || BUILTIN_TEXT_API_KEY,
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
  const [apiKey, baseURL, model, defaultTeachingMode, darkMode, visionApiKey, visionBaseURL, visionModel] =
    await Promise.all([
      getPref(KEYS.apiKey, DEFAULTS.apiKey),
      getPref(KEYS.baseURL, DEFAULTS.baseURL),
      getPref(KEYS.model, DEFAULTS.model),
      getPref(KEYS.defaultTeachingMode, DEFAULTS.defaultTeachingMode),
      getPref(KEYS.darkMode, String(DEFAULTS.darkMode)),
      getPref(KEYS.visionApiKey, DEFAULTS.visionApiKey),
      getPref(KEYS.visionBaseURL, DEFAULTS.visionBaseURL),
      getPref(KEYS.visionModel, DEFAULTS.visionModel),
    ])

  return {
    apiKey,
    baseURL: baseURL || DEFAULTS.baseURL,
    model,
    defaultTeachingMode: defaultTeachingMode as TeachingMode,
    darkMode: darkMode === 'true',
    visionApiKey,
    visionBaseURL: visionBaseURL || DEFAULTS.visionBaseURL,
    visionModel,
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
  if (partial.darkMode !== undefined) tasks.push(setPref(KEYS.darkMode, String(partial.darkMode)))
  if (partial.visionApiKey !== undefined) tasks.push(setPref(KEYS.visionApiKey, partial.visionApiKey))
  if (partial.visionBaseURL !== undefined) tasks.push(setPref(KEYS.visionBaseURL, partial.visionBaseURL))
  if (partial.visionModel !== undefined) tasks.push(setPref(KEYS.visionModel, partial.visionModel))
  await Promise.all(tasks)
  return getSettings()
}

export async function getTextConfig(): Promise<{ apiKey: string; baseURL: string; model: string }> {
  const s = await getSettings()
  return {
    apiKey: BUILTIN_TEXT_API_KEY || s.apiKey,
    baseURL: s.baseURL || DEFAULTS.baseURL,
    model: s.model || DEFAULTS.model,
  }
}

export async function getVisionConfig(): Promise<{ apiKey: string; baseURL: string; model: string }> {
  const s = await getSettings()
  return {
    apiKey: BUILTIN_VISION_API_KEY || BUILTIN_TEXT_API_KEY || s.visionApiKey,
    baseURL: s.visionBaseURL || DEFAULTS.visionBaseURL,
    model: s.visionModel || DEFAULTS.visionModel,
  }
}

export async function getDefaultTeachingMode(): Promise<TeachingMode> {
  const s = await getSettings()
  return s.defaultTeachingMode
}
