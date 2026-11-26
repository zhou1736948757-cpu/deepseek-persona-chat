import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'
import { createId } from '../../utils/id.js'

const STORAGE_KEY = 'chat-demo:custom-tts:v1'
const VOICE_DB_NAME = 'chat-demo-tts-voices'
const VOICE_DB_VERSION = 1

export type TtsEngineMode = 'auto' | 'deepseek' | 'custom'
export type CustomTtsAdapter = 'siliconflow' | 'openai' | 'fish-speech'

export type CustomTtsProfile = {
  id: string
  name: string
  adapter: CustomTtsAdapter
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  speed: number
  fetchedModels: string[]
}

export type ClonedVoiceMeta = {
  id: string
  name: string
  fileName: string
  mimeType: string
  referenceText: string
  /** 若已在硅基流动等云端完成参考音频注册，则保存服务端返回的 voice URI */
  remoteVoiceUri?: string
  createdAt: number
}

interface VoiceDB extends DBSchema {
  audioBlobs: {
    key: string
    value: { id: string; dataUrl: string }
  }
}

export const CUSTOM_TTS_TEMPLATES: Omit<CustomTtsProfile, 'id' | 'apiKey'>[] = [
  {
    name: '硅基流动 CosyVoice2（支持克隆）',
    adapter: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
    speed: 1,
    fetchedModels: [
      'FunAudioLLM/CosyVoice2-0.5B',
      'IndexTeam/IndexTTS-2',
      'fishaudio/fish-speech-1.5',
    ],
  },
  {
    name: 'OpenAI / Edge-TTS 兼容',
    adapter: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1,
    fetchedModels: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
  },
  {
    name: 'Fish-Speech / GPT-SoVITS 本地克隆',
    adapter: 'fish-speech',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'fish-speech-1.5',
    voice: '',
    speed: 1,
    fetchedModels: ['fish-speech-1.5', 'openaudio-s1-mini'],
  },
]

export type CustomTtsState = {
  engineMode: TtsEngineMode
  profiles: CustomTtsProfile[]
  activeProfileId: string
  clonedVoices: ClonedVoiceMeta[]
  activeClonedVoiceId: string | null
}

const DEFAULT_PROFILES: CustomTtsProfile[] = CUSTOM_TTS_TEMPLATES.map((t, idx) => ({
  ...t,
  id: `tts-preset-${idx + 1}`,
  apiKey: '',
}))

const DEFAULT_STATE: CustomTtsState = {
  engineMode: 'auto',
  profiles: DEFAULT_PROFILES,
  activeProfileId: DEFAULT_PROFILES[0].id,
  clonedVoices: [],
  activeClonedVoiceId: null,
}

const loadState = (): CustomTtsState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_STATE
    }
    const parsed = JSON.parse(raw) as Partial<CustomTtsState>
    const profiles =
      Array.isArray(parsed.profiles) && parsed.profiles.length > 0 ? parsed.profiles : DEFAULT_PROFILES
    const activeProfileId =
      typeof parsed.activeProfileId === 'string' && profiles.some((p) => p.id === parsed.activeProfileId)
        ? parsed.activeProfileId
        : profiles[0].id
    const clonedVoices = Array.isArray(parsed.clonedVoices) ? parsed.clonedVoices : []
    const activeClonedVoiceId =
      typeof parsed.activeClonedVoiceId === 'string' &&
      clonedVoices.some((v) => v.id === parsed.activeClonedVoiceId)
        ? parsed.activeClonedVoiceId
        : null
    const engineMode: TtsEngineMode =
      parsed.engineMode === 'deepseek' || parsed.engineMode === 'custom' ? parsed.engineMode : 'auto'
    return { engineMode, profiles, activeProfileId, clonedVoices, activeClonedVoiceId }
  } catch {
    return DEFAULT_STATE
  }
}

export const useCustomTtsStore = create<CustomTtsState>(() => loadState())

const persist = (next: CustomTtsState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 忽略本地存储异常
  }
  useCustomTtsStore.setState(next)
}

export const setTtsEngineMode = (engineMode: TtsEngineMode) => {
  persist({ ...useCustomTtsStore.getState(), engineMode })
}

/** 从 B站云存档恢复语音配置档（保留本地 IndexedDB 参考音频不变）。 */
export const hydrateCustomTtsFromCloud = (
  patch: Partial<Pick<CustomTtsState, 'engineMode' | 'profiles' | 'activeProfileId'>>
) => {
  const prev = useCustomTtsStore.getState()
  const profiles =
    Array.isArray(patch.profiles) && patch.profiles.length > 0 ? patch.profiles : prev.profiles
  const activeProfileId =
    typeof patch.activeProfileId === 'string' && profiles.some((p) => p.id === patch.activeProfileId)
      ? patch.activeProfileId
      : profiles[0].id
  persist({
    ...prev,
    engineMode: patch.engineMode ?? prev.engineMode,
    profiles,
    activeProfileId,
  })
}

export const getActiveTtsProfile = (): CustomTtsProfile => {
  const { profiles, activeProfileId } = useCustomTtsStore.getState()
  return profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? DEFAULT_PROFILES[0]
}

export const activateTtsProfile = (id: string) => {
  const state = useCustomTtsStore.getState()
  if (state.profiles.some((p) => p.id === id)) {
    persist({ ...state, engineMode: 'custom', activeProfileId: id })
  }
}

export const addCustomTtsProfile = (
  draft: Omit<CustomTtsProfile, 'id' | 'fetchedModels'> & { fetchedModels?: string[] }
): CustomTtsProfile => {
  const profile: CustomTtsProfile = {
    id: createId(),
    name: draft.name.trim() || '自定义 TTS',
    adapter: draft.adapter,
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
    voice: draft.voice.trim(),
    speed: draft.speed || 1,
    fetchedModels: draft.fetchedModels ?? (draft.model.trim() ? [draft.model.trim()] : []),
  }
  const state = useCustomTtsStore.getState()
  persist({
    ...state,
    engineMode: 'custom',
    profiles: [profile, ...state.profiles],
    activeProfileId: profile.id,
  })
  return profile
}

export const updateCustomTtsProfile = (id: string, patch: Partial<CustomTtsProfile>) => {
  const state = useCustomTtsStore.getState()
  const profiles = state.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p))
  persist({ ...state, profiles })
}

export const deleteCustomTtsProfile = (id: string) => {
  const state = useCustomTtsStore.getState()
  const profiles = state.profiles.filter((p) => p.id !== id)
  if (profiles.length === 0) {
    return
  }
  const activeProfileId =
    state.activeProfileId === id ? profiles[0].id : state.activeProfileId
  persist({ ...state, profiles, activeProfileId })
}

let voiceDbPromise: Promise<IDBPDatabase<VoiceDB>> | null = null

const getVoiceDB = () =>
  (voiceDbPromise ??= openDB<VoiceDB>(VOICE_DB_NAME, VOICE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('audioBlobs')) {
        db.createObjectStore('audioBlobs', { keyPath: 'id' })
      }
    },
  }).catch((err: unknown) => {
    voiceDbPromise = null
    throw err
  }))

const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取参考音频失败'))
    reader.readAsDataURL(file)
  })

/** 保存本地声音克隆参考音频（存入 IndexedDB，元数据存入 store）。 */
export const saveClonedVoice = async (
  file: File,
  name: string,
  referenceText: string
): Promise<ClonedVoiceMeta> => {
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('参考音频建议控制在 3–15 秒（最大 15 MB）')
  }
  const dataUrl = await fileToDataUrl(file)
  const meta: ClonedVoiceMeta = {
    id: createId(),
    name: name.trim() || file.name.replace(/\.[^.]+$/, '') || '克隆音色',
    fileName: file.name,
    mimeType: file.type || 'audio/wav',
    referenceText: referenceText.trim(),
    createdAt: Date.now(),
  }
  const db = await getVoiceDB()
  await db.put('audioBlobs', { id: meta.id, dataUrl })
  const state = useCustomTtsStore.getState()
  persist({
    ...state,
    clonedVoices: [meta, ...state.clonedVoices],
    activeClonedVoiceId: meta.id,
  })
  return meta
}

export const loadClonedVoiceDataUrl = async (id: string): Promise<string | null> => {
  const db = await getVoiceDB()
  const row = await db.get('audioBlobs', id)
  return row?.dataUrl ?? null
}

export const selectClonedVoice = (id: string | null) => {
  persist({ ...useCustomTtsStore.getState(), activeClonedVoiceId: id })
}

export const updateClonedVoiceMeta = (id: string, patch: Partial<ClonedVoiceMeta>) => {
  const state = useCustomTtsStore.getState()
  persist({
    ...state,
    clonedVoices: state.clonedVoices.map((v) => (v.id === id ? { ...v, ...patch } : v)),
  })
}

export const deleteClonedVoice = async (id: string) => {
  const db = await getVoiceDB()
  await db.delete('audioBlobs', id)
  const state = useCustomTtsStore.getState()
  const clonedVoices = state.clonedVoices.filter((v) => v.id !== id)
  persist({
    ...state,
    clonedVoices,
    activeClonedVoiceId: state.activeClonedVoiceId === id ? null : state.activeClonedVoiceId,
  })
}

/** 一键拉取自定义 TTS 端点的可用语音模型列表（将 TTS/语音模型排在最前）。 */
export const fetchTtsModelsFromEndpoint = async (
  baseUrl: string,
  apiKey = ''
): Promise<string[]> => {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  if (!cleanBase) {
    throw new Error('请先填写 TTS Base URL')
  }
  const headers: Record<string, string> = {}
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }
  const response = await fetch(`${cleanBase}/models`, { method: 'GET', headers })
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`拉取 TTS 模型失败 (${response.status})：${text.slice(0, 160)}`)
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
    throw new Error('接口已连通，但未返回模型列表（可手动填写模型名）')
  }
  const isTts = (id: string) => /(tts|cosyvoice|fish-speech|speech|kokoro|sovits|voice|audio)/i.test(id)
  return [...ids.filter(isTts), ...ids.filter((id) => !isTts(id))]
}

/**
 * 将本地参考音频一键注册为硅基流动动态克隆音色（POST /v1/uploads/audio/voice），
 * 返回官方 voice URI（如 speech:xxx:...）并自动绑定到该音色和当前配置档。
 */
export const registerSiliconFlowClonedVoice = async (
  profile: CustomTtsProfile,
  voiceMeta: ClonedVoiceMeta
): Promise<string> => {
  if (!profile.apiKey.trim()) {
    throw new Error('请先填写硅基流动 API Key')
  }
  if (!voiceMeta.referenceText.trim()) {
    throw new Error('硅基流动声音克隆需要填写参考音频对应的文字内容')
  }
  const dataUrl = await loadClonedVoiceDataUrl(voiceMeta.id)
  if (!dataUrl) {
    throw new Error('本地未找到该参考音频文件，请重新上传')
  }
  const audioBlob = await (await fetch(dataUrl)).blob()
  const form = new FormData()
  form.append('file', audioBlob, voiceMeta.fileName || 'reference.wav')
  form.append('model', profile.model || 'FunAudioLLM/CosyVoice2-0.5B')
  form.append('customName', voiceMeta.name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'clonedvoice')
  form.append('text', voiceMeta.referenceText.trim())

  const cleanBase = profile.baseUrl.replace(/\/+$/, '')
  const response = await fetch(`${cleanBase}/uploads/audio/voice`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${profile.apiKey.trim()}` },
    body: form,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`注册克隆音色失败 (${response.status})：${text.slice(0, 180)}`)
  }
  const body = (await response.json()) as { uri?: string }
  if (!body.uri) {
    throw new Error('服务端未返回克隆音色 URI')
  }
  updateClonedVoiceMeta(voiceMeta.id, { remoteVoiceUri: body.uri })
  updateCustomTtsProfile(profile.id, { voice: body.uri })
  return body.uri
}

/** 调用当前自定义 TTS 入口合成音频 Blob（自动携带克隆参考音频或已注册的克隆 Voice URI）。 */
export const synthesizeWithCustomTts = async (
  text: string,
  signal: AbortSignal
): Promise<Blob> => {
  const state = useCustomTtsStore.getState()
  const profile = getActiveTtsProfile()
  const cleanBase = profile.baseUrl.replace(/\/+$/, '')
  if (!cleanBase) {
    throw new Error('请先配置自定义 TTS 的 Base URL')
  }

  const activeClone = state.activeClonedVoiceId
    ? state.clonedVoices.find((v) => v.id === state.activeClonedVoiceId) ?? null
    : null

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (profile.apiKey.trim()) {
    headers.Authorization = `Bearer ${profile.apiKey.trim()}`
  }

  let endpoint = `${cleanBase}/audio/speech`
  let payload: Record<string, unknown>

  if (profile.adapter === 'fish-speech') {
    endpoint = cleanBase.endsWith('/tts') ? cleanBase : `${cleanBase}/tts`
    const references: { audio: string; text: string }[] = []
    if (activeClone) {
      const dataUrl = await loadClonedVoiceDataUrl(activeClone.id)
      if (dataUrl) {
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        references.push({ audio: base64, text: activeClone.referenceText })
      }
    }
    payload = {
      text,
      format: 'mp3',
      ...(profile.voice.trim() ? { reference_id: profile.voice.trim() } : {}),
      ...(references.length > 0 ? { references } : {}),
    }
  } else if (profile.adapter === 'siliconflow') {
    const useRemoteUri = activeClone?.remoteVoiceUri || profile.voice.trim()
    const references: { audio: string; text: string }[] = []
    if (activeClone && !activeClone.remoteVoiceUri) {
      const dataUrl = await loadClonedVoiceDataUrl(activeClone.id)
      if (dataUrl) {
        references.push({ audio: dataUrl, text: activeClone.referenceText })
      }
    }
    payload = {
      model: profile.model || 'FunAudioLLM/CosyVoice2-0.5B',
      input: text,
      response_format: 'mp3',
      speed: profile.speed || 1,
      ...(references.length > 0
        ? { voice: '', references }
        : { voice: useRemoteUri || 'FunAudioLLM/CosyVoice2-0.5B:alex' }),
    }
  } else {
    // OpenAI / 兼容 /v1/audio/speech
    const refDataUrl =
      activeClone && !activeClone.remoteVoiceUri
        ? await loadClonedVoiceDataUrl(activeClone.id)
        : null
    payload = {
      model: profile.model || 'tts-1',
      input: text,
      voice: activeClone?.remoteVoiceUri || profile.voice.trim() || 'alloy',
      response_format: 'mp3',
      speed: profile.speed || 1,
      ...(refDataUrl
        ? { references: [{ audio: refDataUrl, text: activeClone?.referenceText ?? '' }] }
        : {}),
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    throw new Error(`自定义 TTS 失败 (${response.status})：${errText.slice(0, 180)}`)
  }
  const blob = await response.blob()
  if (blob.size === 0) {
    throw new Error('自定义 TTS 返回空音频')
  }
  return blob
}
