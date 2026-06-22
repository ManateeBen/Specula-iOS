import { useState, useEffect, useCallback } from 'react'
import { Wifi, Moon, Sun, CheckCircle, XCircle, Loader2, Image as ImageIcon, MessageSquare } from 'lucide-react'
import TeachingModePicker from '../components/TeachingModePicker'
import ModelSelect from '../components/ModelSelect'
import { useSettingsStore } from '../stores/settingsStore'
import type { TeachingMode } from '../types'
import {
  TEXT_LLM_PROVIDERS,
  VISION_LLM_PROVIDERS,
  detectTextProvider,
  detectVisionProvider,
  getTextFallbackModels,
  getVisionFallbackModels,
  type LlmProviderId,
  type VisionProviderId,
} from '../constants/llmProviders'

function mergeModels(fetched: string[], fallback: string[], current?: string): string[] {
  const set = new Set<string>([...fallback, ...fetched])
  if (current?.trim()) set.add(current.trim())
  return [...set].sort()
}

export default function Settings() {
  const settings = useSettingsStore()
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [textProvider, setTextProvider] = useState<LlmProviderId>('deepseek')
  const [textModels, setTextModels] = useState<string[]>([])
  const [textModelsLoading, setTextModelsLoading] = useState(false)
  const [textModelsError, setTextModelsError] = useState('')
  const [teachingMode, setTeachingMode] = useState<TeachingMode>('direct')
  const [darkMode, setDarkMode] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [visionApiKey, setVisionApiKey] = useState('')
  const [visionBaseURL, setVisionBaseURL] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [visionProvider, setVisionProvider] = useState<VisionProviderId>('dashscope')
  const [visionModels, setVisionModels] = useState<string[]>([])
  const [visionModelsLoading, setVisionModelsLoading] = useState(false)
  const [visionModelsError, setVisionModelsError] = useState('')
  const [visionTesting, setVisionTesting] = useState(false)
  const [visionTestResult, setVisionTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (settings.loaded) {
      setApiKey(settings.apiKey)
      setBaseURL(settings.baseURL || 'https://api.deepseek.com')
      setModel(settings.model)
      setTextProvider(detectTextProvider(settings.baseURL, settings.model))
      setTeachingMode(settings.defaultTeachingMode)
      setDarkMode(settings.darkMode)
      setVisionApiKey(settings.visionApiKey)
      setVisionBaseURL(settings.visionBaseURL)
      setVisionModel(settings.visionModel)
      setVisionProvider(detectVisionProvider(settings.visionBaseURL))
    }
  }, [settings.loaded, settings.apiKey, settings.baseURL, settings.model, settings.visionBaseURL])

  const fetchTextModels = useCallback(async () => {
    if (!apiKey.trim() || !baseURL.trim()) {
      setTextModels(getTextFallbackModels(textProvider))
      return
    }
    setTextModelsLoading(true)
    setTextModelsError('')
    const res = await window.specula.settings.listTextModels({ apiKey, baseURL })
    const fallback = getTextFallbackModels(textProvider)
    if (res.ok && res.models.length > 0) {
      setTextModels(mergeModels(res.models, fallback, model))
    } else {
      setTextModels(mergeModels([], fallback, model))
      setTextModelsError(res.message ? `${res.message}，已显示预设模型` : '已显示预设模型')
    }
    setTextModelsLoading(false)
  }, [apiKey, baseURL, textProvider, model])

  const fetchVisionModels = useCallback(async () => {
    if (!visionApiKey.trim() || !visionBaseURL.trim()) {
      setVisionModels(getVisionFallbackModels(visionProvider))
      return
    }
    setVisionModelsLoading(true)
    setVisionModelsError('')
    const res = await window.specula.settings.listVisionModels({
      apiKey: visionApiKey,
      baseURL: visionBaseURL,
    })
    const fallback = getVisionFallbackModels(visionProvider)
    if (res.ok && res.models.length > 0) {
      setVisionModels(mergeModels(res.models, fallback, visionModel))
    } else {
      setVisionModels(mergeModels([], fallback, visionModel))
      setVisionModelsError(res.message ? `${res.message}，已显示预设模型` : '已显示预设模型')
    }
    setVisionModelsLoading(false)
  }, [visionApiKey, visionBaseURL, visionProvider, visionModel])

  useEffect(() => {
    if (!apiKey.trim() || !baseURL.trim()) {
      setTextModels(getTextFallbackModels(textProvider))
      return
    }
    const t = setTimeout(() => void fetchTextModels(), 500)
    return () => clearTimeout(t)
  }, [apiKey, baseURL, textProvider, fetchTextModels])

  useEffect(() => {
    if (!visionApiKey.trim() || !visionBaseURL.trim()) {
      setVisionModels(getVisionFallbackModels(visionProvider))
      return
    }
    const t = setTimeout(() => void fetchVisionModels(), 500)
    return () => clearTimeout(t)
  }, [visionApiKey, visionBaseURL, visionProvider, fetchVisionModels])

  const handleTextProviderChange = (id: LlmProviderId) => {
    setTextProvider(id)
    const preset = TEXT_LLM_PROVIDERS.find((p) => p.id === id)
    if (preset && id !== 'custom') {
      setBaseURL(preset.baseURL)
      setModel(preset.defaultModel)
      setTextModels(preset.fallbackModels)
    }
  }

  const handleVisionProviderChange = (id: VisionProviderId) => {
    setVisionProvider(id)
    const preset = VISION_LLM_PROVIDERS.find((p) => p.id === id)
    if (preset && id !== 'custom') {
      setVisionBaseURL(preset.baseURL)
      setVisionModel(preset.defaultModel)
      setVisionModels(preset.fallbackModels)
    }
  }

  const handleSave = async () => {
    await settings.update({
      apiKey,
      baseURL,
      model,
      defaultTeachingMode: teachingMode,
      darkMode,
      visionApiKey,
      visionBaseURL,
      visionModel,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    await settings.update({ apiKey, baseURL, model })
    const result = await window.specula.settings.testConnection()
    setTestResult(result)
    setTesting(false)
  }

  const handleVisionTest = async () => {
    setVisionTesting(true)
    setVisionTestResult(null)
    await settings.update({ visionApiKey, visionBaseURL, visionModel })
    const result = await window.specula.settings.testVision()
    setVisionTestResult(result)
    setVisionTesting(false)
  }

  const textPreset = TEXT_LLM_PROVIDERS.find((p) => p.id === textProvider)
  const visionPreset = VISION_LLM_PROVIDERS.find((p) => p.id === visionProvider)
  const canTestText = !!apiKey.trim() && !!baseURL.trim() && !!model.trim()
  const canTestVision = !!visionApiKey.trim() && !!visionBaseURL.trim() && !!visionModel.trim()
  const canFetchText = !!apiKey.trim() && !!baseURL.trim()
  const canFetchVision = !!visionApiKey.trim() && !!visionBaseURL.trim()

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-bold">设置</h1>
        <p className="mb-6 text-sm text-gray-500">配置 AI 模型与阅读偏好</p>

        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-specula-600" />
              <h2 className="font-medium">文本模型（划线解释 / 测验 / 薄弱点）</h2>
            </div>
            <p className="mb-4 text-xs text-gray-500">
              支持 DeepSeek、OpenAI、阿里云百炼、智谱 GLM 等 OpenAI 兼容接口。填写 API Key 后可下拉选择模型。
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">服务商</label>
                <select
                  value={textProvider}
                  onChange={(e) => handleTextProviderChange(e.target.value as LlmProviderId)}
                  className="input"
                >
                  {TEXT_LLM_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {textPreset?.hint && (
                  <p className="mt-1 text-[11px] text-gray-400">{textPreset.hint}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="input"
                  placeholder="sk-..."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Base URL</label>
                <input
                  type="text"
                  value={baseURL}
                  onChange={(e) => {
                    setBaseURL(e.target.value)
                    setTextProvider('custom')
                  }}
                  className="input"
                  placeholder="https://api.deepseek.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">模型</label>
                <ModelSelect
                  value={model}
                  onChange={setModel}
                  models={textModels}
                  loading={textModelsLoading}
                  error={textModelsError}
                  onRefresh={fetchTextModels}
                  canFetch={canFetchText}
                  disabled={!canFetchText}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button onClick={handleTest} disabled={testing || !canTestText} className="btn-secondary">
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4" />
                  )}
                  测试连接
                </button>
                {testResult && (
                  <span
                    className={`flex items-center gap-1 text-sm ${
                      testResult.ok ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-1 flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-specula-600" />
              <h2 className="font-medium">视觉模型（EPUB 图片解释）</h2>
            </div>
            <p className="mb-4 text-xs text-gray-500">
              图片讲解需多模态模型（如 Qwen-VL、GPT-4o、智谱 GLM-4V）。填写 API Key 后可下拉选择。
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">服务商</label>
                <select
                  value={visionProvider}
                  onChange={(e) => handleVisionProviderChange(e.target.value as VisionProviderId)}
                  className="input"
                >
                  {VISION_LLM_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {visionPreset?.hint && (
                  <p className="mt-1 text-[11px] text-gray-400">{visionPreset.hint}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">API Key</label>
                <input
                  type="password"
                  value={visionApiKey}
                  onChange={(e) => setVisionApiKey(e.target.value)}
                  className="input"
                  placeholder="sk-..."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Base URL</label>
                <input
                  type="text"
                  value={visionBaseURL}
                  onChange={(e) => {
                    setVisionBaseURL(e.target.value)
                    setVisionProvider('custom')
                  }}
                  className="input"
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">模型</label>
                <ModelSelect
                  value={visionModel}
                  onChange={setVisionModel}
                  models={visionModels}
                  loading={visionModelsLoading}
                  error={visionModelsError}
                  onRefresh={fetchVisionModels}
                  canFetch={canFetchVision}
                  disabled={!canFetchVision}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleVisionTest}
                  disabled={visionTesting || !canTestVision}
                  className="btn-secondary"
                >
                  {visionTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                  测试连接
                </button>
                {visionTestResult && (
                  <span
                    className={`flex items-center gap-1 text-sm ${
                      visionTestResult.ok ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {visionTestResult.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {visionTestResult.message}
                  </span>
                )}
              </div>
            </div>
          </section>

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
                onClick={() => setDarkMode(!darkMode)}
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
