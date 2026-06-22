export type LlmProviderId = 'deepseek' | 'openai' | 'dashscope' | 'moonshot' | 'zhipu' | 'custom'

export type VisionProviderId = 'dashscope' | 'openai' | 'zhipu' | 'custom'

export interface LlmProviderPreset {
  id: LlmProviderId
  label: string
  baseURL: string
  defaultModel: string
  fallbackModels: string[]
  hint?: string
}

export interface VisionProviderPreset {
  id: VisionProviderId
  label: string
  baseURL: string
  defaultModel: string
  fallbackModels: string[]
  hint?: string
}

export const TEXT_LLM_PROVIDERS: LlmProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    fallbackModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'o1-mini'],
  },
  {
    id: 'dashscope',
    label: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    fallbackModels: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
    hint: '兼容 OpenAI 接口的通义千问文本模型',
  },
  {
    id: 'moonshot',
    label: 'Moonshot（月之暗面）',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    fallbackModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'zhipu',
    label: '智谱 AI（GLM）',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    fallbackModels: [
      'glm-4-flash',
      'glm-4-air',
      'glm-4-plus',
      'glm-4-long',
      'glm-4.5',
      'glm-4.6',
      'glm-5',
      'glm-5.1',
      'glm-z1-flash',
    ],
    hint: '智谱 OpenAI 兼容接口',
  },
  {
    id: 'custom',
    label: '自定义',
    baseURL: '',
    defaultModel: '',
    fallbackModels: [],
    hint: '任意 OpenAI 兼容 API 的 Base URL',
  },
]

export const VISION_LLM_PROVIDERS: VisionProviderPreset[] = [
  {
    id: 'dashscope',
    label: '阿里云百炼（Qwen-VL）',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-vl-max',
    fallbackModels: ['qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct'],
  },
  {
    id: 'openai',
    label: 'OpenAI（GPT-4o 等）',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    fallbackModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
  },
  {
    id: 'zhipu',
    label: '智谱 AI（GLM-4V）',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4v-plus',
    fallbackModels: ['glm-4v-plus', 'glm-4v-flash', 'glm-4v'],
    hint: '智谱多模态 GLM 视觉模型',
  },
  {
    id: 'custom',
    label: '自定义',
    baseURL: '',
    defaultModel: '',
    fallbackModels: [],
    hint: '需支持 OpenAI 兼容的多模态 chat/completions 接口',
  },
]

export function detectTextProvider(baseURL: string, model: string): LlmProviderId {
  const url = baseURL.trim().toLowerCase()
  if (!url) return 'custom'
  for (const p of TEXT_LLM_PROVIDERS) {
    if (p.id !== 'custom' && url === p.baseURL.toLowerCase()) return p.id
  }
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('openai.com')) return 'openai'
  if (url.includes('dashscope') || url.includes('aliyuncs')) return 'dashscope'
  if (url.includes('moonshot')) return 'moonshot'
  if (url.includes('bigmodel.cn') || url.includes('zhipu')) return 'zhipu'
  if (model.includes('deepseek')) return 'deepseek'
  if (model.startsWith('glm')) return 'zhipu'
  return 'custom'
}

export function detectVisionProvider(baseURL: string): VisionProviderId {
  const url = baseURL.trim().toLowerCase()
  if (!url) return 'custom'
  for (const p of VISION_LLM_PROVIDERS) {
    if (p.id !== 'custom' && url === p.baseURL.toLowerCase()) return p.id
  }
  if (url.includes('openai.com')) return 'openai'
  if (url.includes('dashscope') || url.includes('aliyuncs')) return 'dashscope'
  if (url.includes('bigmodel.cn') || url.includes('zhipu')) return 'zhipu'
  return 'custom'
}

export function getTextFallbackModels(providerId: LlmProviderId): string[] {
  return TEXT_LLM_PROVIDERS.find((p) => p.id === providerId)?.fallbackModels ?? []
}

export function getVisionFallbackModels(providerId: VisionProviderId): string[] {
  return VISION_LLM_PROVIDERS.find((p) => p.id === providerId)?.fallbackModels ?? []
}
