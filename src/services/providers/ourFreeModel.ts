import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError } from '../api/client.js'
import { readMessageEvent } from '../api/parseEvent.js'
import { readServerSentEvents } from '../api/sse.js'
import type { MessageParam, MessageStreamEvent } from '../api/types.js'
import { useSettings } from '../settings.js'

const STORAGE_KEY = 'chat-demo:provider-config:v2'
const LEGACY_STORAGE_KEY = 'chat-demo:provider-config:v1'

export type ChatProviderKind = 'deepseek' | 'ourfree' | 'custom'
export type CustomLlmProtocol = 'openai' | 'anthropic'

export type CustomLlmProfile = {
  id: string
  name: string
  protocol: CustomLlmProtocol
  baseUrl: string
  apiKey: string
  model: string
  fetchedModels: string[]
}

export const BUILTIN_OFM_BASE_URL = '/__ofm/v1'

export const OURFREE_PRESET_ENDPOINTS = [
  {
    label: '项目内置 OurFreeModel（推荐 · 已装好）',
    baseUrl: BUILTIN_OFM_BASE_URL,
  },
  {
    label: '独立端口 18900（直连本机）',
    baseUrl: 'http://127.0.0.1:18900/v1',
  },
  {
    label: 'OpenCode Zen 公共通道',
    baseUrl: 'https://opencode.ai/zen/v1',
  },
] as const

export const CUSTOM_LLM_TEMPLATES: {
  name: string
  protocol: CustomLlmProtocol
  baseUrl: string
  model: string
}[] = [
  {
    name: '硅基流动 SiliconFlow',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  {
    name: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
  },
  {
    name: 'Ollama 本地模型',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
  },
  {
    name: 'OpenAI / New API 中转',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    name: 'Anthropic 兼容中转',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
  },
]

export const OURFREE_DEFAULT_MODELS = [
  'deepseek-v4.1-flash-free',
  'kilo-auto/free',
  'kimi-k3',
  'glm-5.3-flash',
]

export type BuiltInOfmStatus = {
  checked: boolean
  running: boolean
  version: string
  managementUrl: string
  localApiUrl: string
  error: string
}

export type ProviderConfig = {
  chatProvider: ChatProviderKind
  ourFreeBaseUrl: string
  ourFreeApiKey: string
  ourFreeModel: string
  ourFreeModels: string[]
  customProfiles: CustomLlmProfile[]
  activeCustomProfileId: string | null
  builtInOfm: BuiltInOfmStatus
}

const DEFAULT_BUILTIN_STATUS: BuiltInOfmStatus = {
  checked: false,
  running: false,
  version: '',
  managementUrl: '',
  localApiUrl: '',
  error: '',
}

const DEFAULT_CUSTOM_PROFILES: CustomLlmProfile[] = [
  {
    id: 'preset-siliconflow',
    name: '硅基流动 SiliconFlow',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    model: 'deepseek-ai/DeepSeek-V3',
    fetchedModels: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'],
  },
]

const isToyStaticEnv = (): boolean =>
  (typeof __TOY_BUILD__ !== 'undefined' && __TOY_BUILD__) ||
  (typeof window !== 'undefined' && Boolean(window.toy))

const DEFAULT_PROVIDER: ProviderConfig = {
  chatProvider: isToyStaticEnv() ? 'deepseek' : 'ourfree',
  ourFreeBaseUrl: BUILTIN_OFM_BASE_URL,
  ourFreeApiKey: '',
  ourFreeModel: OURFREE_DEFAULT_MODELS[0],
  ourFreeModels: OURFREE_DEFAULT_MODELS,
  customProfiles: DEFAULT_CUSTOM_PROFILES,
  activeCustomProfileId: DEFAULT_CUSTOM_PROFILES[0].id,
  builtInOfm: DEFAULT_BUILTIN_STATUS,
}

const loadProvider = (): ProviderConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_PROVIDER
    }
    const parsed = JSON.parse(raw) as Partial<ProviderConfig>
    const rawUrl =
      typeof parsed.ourFreeBaseUrl === 'string' && parsed.ourFreeBaseUrl.trim()
        ? parsed.ourFreeBaseUrl.trim()
        : BUILTIN_OFM_BASE_URL
    const migratedUrl = rawUrl === 'http://127.0.0.1:8787/v1' ? BUILTIN_OFM_BASE_URL : rawUrl

    const customProfiles =
      Array.isArray(parsed.customProfiles) && parsed.customProfiles.length > 0
        ? parsed.customProfiles.filter(
            (p): p is CustomLlmProfile =>
              typeof p === 'object' &&
              p !== null &&
              typeof p.id === 'string' &&
              typeof p.name === 'string' &&
              typeof p.baseUrl === 'string'
          )
        : DEFAULT_CUSTOM_PROFILES

    const activeCustomProfileId =
      typeof parsed.activeCustomProfileId === 'string' &&
      customProfiles.some((p) => p.id === parsed.activeCustomProfileId)
        ? parsed.activeCustomProfileId
        : (customProfiles[0]?.id ?? null)

    const chatProvider: ChatProviderKind =
      parsed.chatProvider === 'deepseek' || parsed.chatProvider === 'custom'
        ? parsed.chatProvider
        : 'ourfree'

    return {
      chatProvider,
      ourFreeBaseUrl: migratedUrl,
      ourFreeApiKey: typeof parsed.ourFreeApiKey === 'string' ? parsed.ourFreeApiKey : '',
      ourFreeModel:
        typeof parsed.ourFreeModel === 'string' && parsed.ourFreeModel.trim()
          ? parsed.ourFreeModel.trim()
          : DEFAULT_PROVIDER.ourFreeModel,
      ourFreeModels:
        Array.isArray(parsed.ourFreeModels) && parsed.ourFreeModels.length > 0
          ? parsed.ourFreeModels.filter((m): m is string => typeof m === 'string' && Boolean(m.trim()))
          : DEFAULT_PROVIDER.ourFreeModels,
      customProfiles,
      activeCustomProfileId,
      builtInOfm: DEFAULT_BUILTIN_STATUS,
    }
  } catch {
    return DEFAULT_PROVIDER
  }
}

export const useProviderStore = create<ProviderConfig>(() => loadProvider())

const persist = (next: ProviderConfig) => {
  try {
    const persisted = {
      chatProvider: next.chatProvider,
      ourFreeBaseUrl: next.ourFreeBaseUrl,
      ourFreeApiKey: next.ourFreeApiKey,
      ourFreeModel: next.ourFreeModel,
      ourFreeModels: next.ourFreeModels,
      customProfiles: next.customProfiles,
      activeCustomProfileId: next.activeCustomProfileId,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    // 忽略本地存储异常
  }
  useProviderStore.setState(next)
}

export const updateProviderConfig = (patch: Partial<ProviderConfig>) => {
  persist({ ...useProviderStore.getState(), ...patch })
}

export const getActiveCustomProfile = (): CustomLlmProfile | null => {
  const { customProfiles, activeCustomProfileId } = useProviderStore.getState()
  return customProfiles.find((p) => p.id === activeCustomProfileId) ?? customProfiles[0] ?? null
}

export const addCustomLlmProfile = (
  draft: Omit<CustomLlmProfile, 'id' | 'fetchedModels'> & { fetchedModels?: string[] },
  activate = true
): CustomLlmProfile => {
  const profile: CustomLlmProfile = {
    id: createId(),
    name: draft.name.trim() || '自定义模型源',
    protocol: draft.protocol,
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
    fetchedModels: draft.fetchedModels ?? (draft.model.trim() ? [draft.model.trim()] : []),
  }
  const state = useProviderStore.getState()
  persist({
    ...state,
    customProfiles: [profile, ...state.customProfiles],
    ...(activate ? { chatProvider: 'custom', activeCustomProfileId: profile.id } : {}),
  })
  return profile
}

export const updateCustomLlmProfile = (id: string, patch: Partial<CustomLlmProfile>) => {
  const state = useProviderStore.getState()
  const customProfiles = state.customProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p))
  persist({ ...state, customProfiles })
}

export const deleteCustomLlmProfile = (id: string) => {
  const state = useProviderStore.getState()
  const customProfiles = state.customProfiles.filter((p) => p.id !== id)
  const nextActive =
    state.activeCustomProfileId === id ? (customProfiles[0]?.id ?? null) : state.activeCustomProfileId
  const nextProvider =
    state.chatProvider === 'custom' && customProfiles.length === 0 ? 'ourfree' : state.chatProvider
  persist({
    ...state,
    customProfiles,
    activeCustomProfileId: nextActive,
    chatProvider: nextProvider,
  })
}

export const activateCustomLlmProfile = (id: string) => {
  const state = useProviderStore.getState()
  if (state.customProfiles.some((p) => p.id === id)) {
    persist({ ...state, chatProvider: 'custom', activeCustomProfileId: id })
  }
}

/**
 * 通用一键拉取模型列表（兼容 OpenAI /v1/models、Anthropic /v1/models 及 Ollama /api/tags）。
 */
export const fetchModelsFromEndpoint = async (
  baseUrl: string,
  apiKey = '',
  protocol: CustomLlmProtocol = 'openai',
  signal?: AbortSignal
): Promise<string[]> => {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  if (!cleanBase) {
    throw new Error('请先填写 Base URL')
  }
  const headers: Record<string, string> = {}
  if (apiKey.trim()) {
    if (protocol === 'anthropic') {
      headers['x-api-key'] = apiKey.trim()
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.Authorization = `Bearer ${apiKey.trim()}`
    }
  }

  const response = await fetch(`${cleanBase}/models`, {
    method: 'GET',
    headers,
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`拉取模型失败 (${response.status})：${text.slice(0, 160)}`)
  }
  const body = (await response.json()) as {
    data?: { id?: string; name?: string }[]
    models?: { id?: string; name?: string }[]
  }
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
  const ids = [
    ...new Set(
      list
        .map((item) => item.id ?? item.name)
        .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    ),
  ]
  if (ids.length === 0) {
    throw new Error('接口已连通，但未返回可用模型列表（可手动填写模型名）')
  }
  return ids
}

/** 兼容旧调用：从内置或外部 OurFreeModel 拉取当前真实可用的免费模型列表。 */
export const fetchOurFreeModels = (baseUrl: string, apiKey = '', signal?: AbortSignal) =>
  fetchModelsFromEndpoint(baseUrl, apiKey, 'openai', signal)

const pickPreferredFreeModel = (models: string[], current: string): string => {
  if (models.includes(current)) {
    return current
  }
  return (
    models.find((m) => m.toLowerCase().includes('deepseek')) ??
    models.find((m) => m.toLowerCase().includes('kilo-auto')) ??
    models.find((m) => m.toLowerCase().includes('free')) ??
    models[0]
  )
}

/** 启动时自动探测项目内置的 OurFreeModel 服务并同步实时免费模型清单。 */
export const initBuiltInOurFreeModel = async (): Promise<void> => {
  // B站 Toy 纯静态环境下无本机 Node 桥接服务，跳过 /__ofm/status 探测避免 404
  if (isToyStaticEnv()) {
    const cur = useProviderStore.getState()
    if (cur.chatProvider === 'ourfree' && cur.ourFreeBaseUrl === BUILTIN_OFM_BASE_URL) {
      updateProviderConfig({ chatProvider: 'deepseek' })
    }
    useProviderStore.setState({
      builtInOfm: {
        checked: true,
        running: false,
        version: '',
        managementUrl: '',
        localApiUrl: '',
        error: 'B站 Toy 在线静态版请使用 DeepSeek Key 或自定义 LLM（可在 B站云存档同步）',
      },
    })
    return
  }
  try {
    const resp = await fetch('/__ofm/status', { cache: 'no-store' })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }
    const status = (await resp.json()) as {
      running?: boolean
      version?: string
      managementUrl?: string
      localApiUrl?: string
      error?: string
    }
    const builtInOfm: BuiltInOfmStatus = {
      checked: true,
      running: Boolean(status.running),
      version: status.version ?? '',
      managementUrl: status.managementUrl ?? '',
      localApiUrl: status.localApiUrl ?? '',
      error: status.error ?? '',
    }
    useProviderStore.setState({ builtInOfm })

    if (!builtInOfm.running) {
      return
    }

    const currentState = useProviderStore.getState()
    if (currentState.ourFreeBaseUrl !== BUILTIN_OFM_BASE_URL) {
      return
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const models = await fetchOurFreeModels(BUILTIN_OFM_BASE_URL)
        const latest = useProviderStore.getState()
        const selected = pickPreferredFreeModel(models, latest.ourFreeModel)
        updateProviderConfig({ ourFreeModels: models, ourFreeModel: selected })
        return
      } catch {
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }
      }
    }
  } catch (err) {
    useProviderStore.setState({
      builtInOfm: {
        checked: true,
        running: false,
        version: '',
        managementUrl: '',
        localApiUrl: '',
        error: err instanceof Error ? err.message : String(err),
      },
    })
  }
}

const flattenMessageText = (
  param: MessageParam
): { role: 'user' | 'assistant'; content: string } | null => {
  if (param.role === 'latest_reminder') {
    return null
  }
  if (param.role === 'user') {
    if (typeof param.content === 'string') {
      return { role: 'user', content: param.content }
    }
    const text = param.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    return text ? { role: 'user', content: text } : null
  }
  const text = param.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
  return text ? { role: 'assistant', content: text } : null
}

/** 通用 OpenAI 兼容 SSE 流式对话（服务于内置 OurFreeModel 与 OpenAI 协议自定义配置档）。 */
async function* streamOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: MessageParam[],
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const openAiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
  if (system.trim()) {
    openAiMessages.push({ role: 'system', content: system.trim() })
  }
  for (const msg of messages) {
    const flat = flattenMessageText(msg)
    if (flat) {
      openAiMessages.push(flat)
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }

  const { thinking, thinkingEffort } = useSettings.getState()

  let response: Response
  try {
    response = await fetch(`${cleanBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: openAiMessages,
        stream: true,
        ...(thinking ? { reasoning_effort: thinkingEffort } : {}),
      }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError(
      'network',
      `无法连接到模型接口（${cleanBase}）：${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new ApiError('http', text || response.statusText, response.status)
  }

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body) {
    throw new ApiError('protocol', '模型接口响应为空')
  }

  if (!contentType.includes('text/event-stream')) {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[]
    }
    const choice = json.choices?.[0]?.message
    yield { type: 'message_start', message: { id: 'openai-compat', model } }
    let idx = 0
    if (choice?.reasoning_content) {
      yield {
        type: 'content_block_start',
        index: idx,
        content_block: { type: 'thinking', thinking: choice.reasoning_content, signature: '' },
      }
      yield { type: 'content_block_stop', index: idx }
      idx += 1
    }
    if (choice?.content) {
      yield {
        type: 'content_block_start',
        index: idx,
        content_block: { type: 'text', text: choice.content },
      }
      yield { type: 'content_block_stop', index: idx }
    }
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
    yield { type: 'message_stop' }
    return
  }

  yield { type: 'message_start', message: { id: 'openai-compat', model } }

  let thinkingIndex: number | null = null
  let textIndex: number | null = null
  let nextIndex = 0

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    const trimmed = data.trim()
    if (!trimmed || trimmed === '[DONE]') {
      break
    }
    let chunk: {
      choices?: {
        delta?: { content?: string; reasoning_content?: string }
        finish_reason?: string | null
      }[]
      error?: { message?: string }
    }
    try {
      chunk = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (chunk.error?.message) {
      throw new ApiError('stream', chunk.error.message)
    }
    const delta = chunk.choices?.[0]?.delta
    if (!delta) {
      continue
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      if (thinkingIndex === null) {
        thinkingIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      }
    }
    if (typeof delta.content === 'string' && delta.content) {
      if (thinkingIndex !== null && textIndex === null) {
        yield { type: 'content_block_stop', index: thinkingIndex }
      }
      if (textIndex === null) {
        textIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: delta.content },
      }
    }
  }

  if (thinkingIndex !== null && textIndex === null) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  }
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
  yield { type: 'message_stop' }
}

/** 自定义 Anthropic 兼容端点 SSE 流式对话（POST ${baseUrl}/messages）。 */
async function* streamAnthropicCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: MessageParam[],
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const anthMessages = messages
    .map(flattenMessageText)
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => m !== null)

  let response: Response
  try {
    response = await fetch(`${cleanBase}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'anthropic-version': '2023-06-01',
        ...(apiKey.trim() ? { 'x-api-key': apiKey.trim() } : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system,
        messages: anthMessages,
        stream: true,
      }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError(
      'network',
      `无法连接到 Anthropic 兼容接口（${cleanBase}）：${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => response.statusText)
    throw new ApiError('http', text || response.statusText, response.status)
  }

  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const ev = readMessageEvent(payload)
    if (!ev) {
      continue
    }
    yield ev
    if (ev.type === 'message_stop') {
      return
    }
  }
}

export async function* streamOurFreeMessage(
  system: string,
  messages: MessageParam[],
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const { ourFreeBaseUrl, ourFreeApiKey, ourFreeModel } = useProviderStore.getState()
  yield* streamOpenAiCompatible(ourFreeBaseUrl, ourFreeApiKey, ourFreeModel, system, messages, signal)
}

export async function* streamCustomProfileMessage(
  system: string,
  messages: MessageParam[],
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const profile = getActiveCustomProfile()
  if (!profile || !profile.baseUrl.trim() || !profile.model.trim()) {
    throw new ApiError('protocol', '当前自定义模型配置不完整，请先填写 Base URL 和模型名称')
  }
  if (profile.protocol === 'anthropic') {
    yield* streamAnthropicCompatible(
      profile.baseUrl,
      profile.apiKey,
      profile.model,
      system,
      messages,
      signal
    )
  } else {
    yield* streamOpenAiCompatible(
      profile.baseUrl,
      profile.apiKey,
      profile.model,
      system,
      messages,
      signal
    )
  }
}
