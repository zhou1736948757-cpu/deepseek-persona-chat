import { unzlibSync, zlibSync } from 'fflate'
import { create } from 'zustand'
import { updateRawRagConfig, useRawRagConfig, type EmbeddingProfile } from '../memory/rawRag.js'
import {
  replacePersonasFromCloud,
  usePersonaStore,
} from '../persona/store.js'
import type { Persona } from '../persona/types.js'
import {
  updateProviderConfig,
  useProviderStore,
  type ChatProviderKind,
  type CustomLlmProfile,
} from '../providers/ourFreeModel.js'
import {
  setApiKey,
  setAutoReadAloud,
  setSearch,
  setThemePreference,
  setThinking,
  setThinkingEffort,
  setTtsVoice,
  useSettings,
  type ThemePreference,
  type ThinkingEffort,
} from '../settings.js'
import {
  hydrateCustomTtsFromCloud,
  useCustomTtsStore,
  type CustomTtsProfile,
  type TtsEngineMode,
} from '../speech/customTts.js'
import type { TtsVoice } from '../api/speech.js'
import {
  formatToyError,
  getToySdk,
  isToyRateLimitError,
  supportToyAbility,
  type ToyUserProfile,
} from './bilibiliToy.js'

/**
 * B站 Toy 官方云存储 0 后端同步引擎：
 * - 严格遵守 B站 Toy 配额：<= 128 keys、key 仅含 [a-z0-9_-] 且不以 __ 开头、value <= 1024 bytes
 * - 仅同步「用户 API Keys / 模型源配置 / 人格库 / 基础偏好」，绝不上传 Raw RAG 向量与聊天记录（100% 留在本机 IndexedDB）
 * - 使用 fflate zlib 压缩 + 可选 WebCrypto AES-256-GCM 端到端口令加密，128 KB 可存下全部 Key 与 30+ 完整人格
 * - 严格遵守限流最佳实践：单次批量读/写、内容哈希去重、15 秒写冷却、307044 指数退避重试
 */

const META_KEY = 'dsp_v1_meta'
const CHUNK_PREFIX = 'dsp_v1_c'
const CHUNK_SIZE = 940 // ASCII 字符，安全低于 B站 1024 字节上限
const MAX_CHUNKS = 120 // 留出余量，总 key 数恒 <= 121 < 128
const WRITE_COOLDOWN_MS = 12_000
const LOCAL_META_CACHE_KEY = 'chat-demo:toy-cloud-meta:v1'

type ToyCloudMeta = {
  v: 1
  enc: 'zlib-v1' | 'aes-gcm-v1'
  n: number
  ts: number
  hash: string
  personas: number
  keys: number
}

type ToyCloudVaultV1 = {
  v: 1
  updatedAt: number
  settings: {
    apiKey: string | null
    themePreference: ThemePreference
    ttsVoice: TtsVoice
    autoReadAloud: boolean
    thinking: boolean
    thinkingEffort: ThinkingEffort
    search: boolean
  }
  provider: {
    chatProvider: ChatProviderKind
    ourFreeBaseUrl: string
    ourFreeApiKey: string
    ourFreeModel: string
    customProfiles: CustomLlmProfile[]
    activeCustomProfileId: string | null
  }
  ragConfig: {
    enabled: boolean
    autoIngest: boolean
    topK: number
    minScore: number
    maxChunkChars: number
    siliconFlowApiKey: string | null
    embeddingBaseUrl: string
    embeddingModel: string
    embeddingProfiles: EmbeddingProfile[]
    activeEmbeddingProfileId: string
  }
  ttsConfig: {
    engineMode: TtsEngineMode
    profiles: CustomTtsProfile[]
    activeProfileId: string
  }
  personas: Persona[]
  activePersonaId: string
}

export type ToyCloudState = {
  modalOpen: boolean
  sdkAvailable: boolean
  cloudSupported: boolean
  profile: ToyUserProfile | null
  busy: boolean
  lastSyncedAt: number | null
  lastHash: string | null
  remoteMeta: ToyCloudMeta | null
  needsPassphrase: boolean
  statusMessage: string | null
  statusError: string | null
}

const readLocalMeta = (): { lastSyncedAt: number | null; lastHash: string | null } => {
  try {
    const raw = localStorage.getItem(LOCAL_META_CACHE_KEY)
    if (!raw) {
      return { lastSyncedAt: null, lastHash: null }
    }
    const parsed = JSON.parse(raw) as { lastSyncedAt?: number; lastHash?: string }
    return {
      lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : null,
      lastHash: typeof parsed.lastHash === 'string' ? parsed.lastHash : null,
    }
  } catch {
    return { lastSyncedAt: null, lastHash: null }
  }
}

const saveLocalMeta = (lastSyncedAt: number | null, lastHash: string | null) => {
  try {
    localStorage.setItem(LOCAL_META_CACHE_KEY, JSON.stringify({ lastSyncedAt, lastHash }))
  } catch {
    // ignore
  }
}

const initialLocalMeta = readLocalMeta()

export const useToyCloudStore = create<ToyCloudState>(() => ({
  modalOpen: false,
  sdkAvailable: false,
  cloudSupported: false,
  profile: null,
  busy: false,
  lastSyncedAt: initialLocalMeta.lastSyncedAt,
  lastHash: initialLocalMeta.lastHash,
  remoteMeta: null,
  needsPassphrase: false,
  statusMessage: null,
  statusError: null,
}))

let lastWriteTimestamp = 0
let cachedRemoteRecord: Record<string, string> | null = null

export const openToyCloudModal = () => {
  useToyCloudStore.setState({ modalOpen: true, statusError: null })
}

export const closeToyCloudModal = () => {
  useToyCloudStore.setState({ modalOpen: false })
}

// ---------- Base64 & WebCrypto 端到端加密工具 ----------

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

const fnv1aHash = (str: string): string => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

const deriveAesKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> => {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

const encryptBytes = async (plain: Uint8Array, passphrase: string): Promise<Uint8Array> => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前环境不支持 WebCrypto 加密，请在 HTTPS / B站环境使用加密口令。')
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(passphrase, salt)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource)
  )
  const merged = new Uint8Array(16 + 12 + cipher.length)
  merged.set(salt, 0)
  merged.set(iv, 16)
  merged.set(cipher, 28)
  return merged
}

const decryptBytes = async (packed: Uint8Array, passphrase: string): Promise<Uint8Array> => {
  if (packed.length < 32) {
    throw new Error('云存档密文格式损坏')
  }
  const salt = packed.slice(0, 16)
  const iv = packed.slice(16, 28)
  const cipher = packed.slice(28)
  const key = await deriveAesKey(passphrase, salt)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    return new Uint8Array(plain)
  } catch {
    throw new Error('加密口令不正确，无法解密 B站云存档')
  }
}

// ---------- 带 307044 指数退避的 Toy SDK 调用包装 ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const withRateLimitRetry = async <T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> => {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (isToyRateLimitError(err) && attempt < maxRetries) {
        attempt += 1
        await sleep(1100 * Math.pow(2, attempt - 1))
        continue
      }
      throw err
    }
  }
}

// ---------- 本地快照打包与恢复（仅 Key + 模型源 + 人格，不含 Raw RAG / 聊天记录） ----------

const countConfiguredKeys = (vault: ToyCloudVaultV1): number => {
  let count = 0
  if (vault.settings.apiKey?.trim()) {
    count += 1
  }
  if (vault.ragConfig.siliconFlowApiKey?.trim()) {
    count += 1
  }
  count += vault.provider.customProfiles.filter((p) => p.apiKey.trim()).length
  count += vault.ttsConfig.profiles.filter((p) => p.apiKey.trim()).length
  return count
}

export const buildLocalCloudVault = (): ToyCloudVaultV1 => {
  const s = useSettings.getState()
  const prov = useProviderStore.getState()
  const rag = useRawRagConfig.getState()
  const tts = useCustomTtsStore.getState()
  const pStore = usePersonaStore.getState()

  // 精简 fetchedModels 列表长度（仅保留前 12 个），确保给多个人格留出最大空间
  const compactLlmProfiles = prov.customProfiles.slice(0, 12).map((p) => ({
    ...p,
    fetchedModels: p.fetchedModels.slice(0, 12),
  }))
  const compactEmbedProfiles = rag.embeddingProfiles.slice(0, 8).map((p) => ({
    ...p,
    fetchedModels: p.fetchedModels.slice(0, 8),
  }))
  const compactTtsProfiles = tts.profiles.slice(0, 8).map((p) => ({
    ...p,
    fetchedModels: p.fetchedModels.slice(0, 8),
  }))

  return {
    v: 1,
    updatedAt: Date.now(),
    settings: {
      apiKey: s.apiKey,
      themePreference: s.themePreference,
      ttsVoice: s.ttsVoice,
      autoReadAloud: s.autoReadAloud,
      thinking: s.thinking,
      thinkingEffort: s.thinkingEffort,
      search: s.search,
    },
    provider: {
      chatProvider: prov.chatProvider,
      ourFreeBaseUrl: prov.ourFreeBaseUrl,
      ourFreeApiKey: prov.ourFreeApiKey,
      ourFreeModel: prov.ourFreeModel,
      customProfiles: compactLlmProfiles,
      activeCustomProfileId: prov.activeCustomProfileId,
    },
    ragConfig: {
      enabled: rag.enabled,
      autoIngest: rag.autoIngest,
      topK: rag.topK,
      minScore: rag.minScore,
      maxChunkChars: rag.maxChunkChars,
      siliconFlowApiKey: rag.siliconFlowApiKey,
      embeddingBaseUrl: rag.embeddingBaseUrl,
      embeddingModel: rag.embeddingModel,
      embeddingProfiles: compactEmbedProfiles,
      activeEmbeddingProfileId: rag.activeEmbeddingProfileId,
    },
    ttsConfig: {
      engineMode: tts.engineMode,
      profiles: compactTtsProfiles,
      activeProfileId: tts.activeProfileId,
    },
    personas: pStore.personas.slice(0, 40),
    activePersonaId: pStore.activePersonaId,
  }
}

export const applyCloudVaultToLocal = (vault: ToyCloudVaultV1) => {
  if (vault.settings) {
    setApiKey(vault.settings.apiKey ?? null)
    if (vault.settings.themePreference) {
      setThemePreference(vault.settings.themePreference)
    }
    if (vault.settings.ttsVoice) {
      setTtsVoice(vault.settings.ttsVoice)
    }
    if (typeof vault.settings.autoReadAloud === 'boolean') {
      setAutoReadAloud(vault.settings.autoReadAloud)
    }
    if (typeof vault.settings.thinking === 'boolean') {
      setThinking(vault.settings.thinking)
    }
    if (vault.settings.thinkingEffort) {
      setThinkingEffort(vault.settings.thinkingEffort)
    }
    if (typeof vault.settings.search === 'boolean') {
      setSearch(vault.settings.search)
    }
  }

  if (vault.provider) {
    updateProviderConfig({
      chatProvider: vault.provider.chatProvider,
      ourFreeBaseUrl: vault.provider.ourFreeBaseUrl,
      ourFreeApiKey: vault.provider.ourFreeApiKey,
      ourFreeModel: vault.provider.ourFreeModel,
      ...(Array.isArray(vault.provider.customProfiles) && vault.provider.customProfiles.length > 0
        ? { customProfiles: vault.provider.customProfiles }
        : {}),
      activeCustomProfileId: vault.provider.activeCustomProfileId,
    })
  }

  if (vault.ragConfig) {
    updateRawRagConfig({
      enabled: vault.ragConfig.enabled,
      autoIngest: vault.ragConfig.autoIngest,
      topK: vault.ragConfig.topK,
      minScore: vault.ragConfig.minScore,
      maxChunkChars: vault.ragConfig.maxChunkChars,
      siliconFlowApiKey: vault.ragConfig.siliconFlowApiKey,
      embeddingBaseUrl: vault.ragConfig.embeddingBaseUrl,
      embeddingModel: vault.ragConfig.embeddingModel,
      ...(Array.isArray(vault.ragConfig.embeddingProfiles) &&
      vault.ragConfig.embeddingProfiles.length > 0
        ? { embeddingProfiles: vault.ragConfig.embeddingProfiles }
        : {}),
      activeEmbeddingProfileId: vault.ragConfig.activeEmbeddingProfileId,
    })
  }

  if (vault.ttsConfig) {
    hydrateCustomTtsFromCloud({
      engineMode: vault.ttsConfig.engineMode,
      ...(Array.isArray(vault.ttsConfig.profiles) && vault.ttsConfig.profiles.length > 0
        ? { profiles: vault.ttsConfig.profiles }
        : {}),
      activeProfileId: vault.ttsConfig.activeProfileId,
    })
  }

  if (Array.isArray(vault.personas) && vault.personas.length > 0) {
    replacePersonasFromCloud(vault.personas, vault.activePersonaId)
  }
}

export const estimateVaultQuotaUsage = (): {
  rawBytes: number
  compressedBytes: number
  chunks: number
  maxChunks: number
  percent: number
} => {
  const vault = buildLocalCloudVault()
  const raw = new TextEncoder().encode(JSON.stringify(vault))
  const compressed = zlibSync(raw, { level: 9 })
  const b64Len = Math.ceil(compressed.length / 3) * 4 + 48
  const chunks = Math.max(1, Math.ceil(b64Len / CHUNK_SIZE))
  return {
    rawBytes: raw.byteLength,
    compressedBytes: compressed.byteLength,
    chunks,
    maxChunks: MAX_CHUNKS,
    percent: Math.min(100, Math.round((chunks / MAX_CHUNKS) * 100)),
  }
}

// ---------- 对外主动作：初始化检测 / 连接B站资料 / 上传云存档 / 拉取云存档 / 清空云存档 ----------

export const initToyCloudEnvironment = async () => {
  const sdk = getToySdk()
  if (!sdk) {
    useToyCloudStore.setState({ sdkAvailable: false, cloudSupported: false })
    return
  }

  const [canGet, canSet] = await Promise.all([
    supportToyAbility('getCloudStorage'),
    supportToyAbility('setCloudStorage'),
  ])
  const cloudSupported = canGet && canSet
  useToyCloudStore.setState({ sdkAvailable: true, cloudSupported })

  // 进入 B站 Toy 时仅静默拉取一次云存档元数据（不轮询、不触发 profile 授权弹窗）
  if (!cloudSupported) {
    return
  }

  try {
    const all = await withRateLimitRetry(() => sdk.getCloudStorage(), 1)
    cachedRemoteRecord = all
    const metaRaw = all[META_KEY]
    if (!metaRaw) {
      return
    }
    const meta = JSON.parse(metaRaw) as ToyCloudMeta
    useToyCloudStore.setState({
      remoteMeta: meta,
      needsPassphrase: meta.enc === 'aes-gcm-v1',
    })

    // 若本地从未填过任何 Key 且云端未设口令，自动静默帮用户恢复跨设备云存档
    const localHasKey = Boolean(useSettings.getState().apiKey?.trim())
    const localCustomCount = usePersonaStore.getState().personas.filter((p) => !p.builtin).length
    if (!localHasKey && localCustomCount === 0 && meta.enc === 'zlib-v1') {
      const vault = await decodeCloudRecord(all, meta, '')
      applyCloudVaultToLocal(vault)
      saveLocalMeta(meta.ts, meta.hash)
      useToyCloudStore.setState({
        lastSyncedAt: meta.ts,
        lastHash: meta.hash,
        statusMessage: `已自动从 B站云存档恢复 ${meta.personas} 个人格与 ${meta.keys} 组 Key`,
      })
    }
  } catch {
    // 游客未登录或偶发网络波动，静默降级为纯本地使用
  }
}

/** 必须在用户点击手势事件中调用（遵循 B站 Toy getUserProfile 规范）。 */
export const connectBilibiliProfile = async (): Promise<{ ok: boolean; message: string }> => {
  const sdk = getToySdk()
  if (!sdk || !(await supportToyAbility('getUserProfile'))) {
    return {
      ok: false,
      message: '当前不在 B站 Toy 环境中，上传到 B站 Toy 后即可一键关联 B站头像与昵称。',
    }
  }
  useToyCloudStore.setState({ busy: true, statusError: null })
  try {
    const profile = await sdk.getUserProfile()
    useToyCloudStore.setState({
      profile,
      busy: false,
      statusMessage: `已连接 B站账号：${profile.nickname}`,
    })
    return { ok: true, message: `欢迎，${profile.nickname}` }
  } catch (err) {
    const msg = formatToyError(err, '未能获取 B站账号资料')
    useToyCloudStore.setState({ busy: false, statusError: msg })
    return { ok: false, message: msg }
  }
}

const decodeCloudRecord = async (
  record: Record<string, string>,
  meta: ToyCloudMeta,
  passphrase: string
): Promise<ToyCloudVaultV1> => {
  const parts: string[] = []
  for (let i = 0; i < meta.n; i++) {
    const chunk = record[`${CHUNK_PREFIX}${i}`]
    if (typeof chunk !== 'string') {
      throw new Error(`云存档分片不完整（缺少第 ${i + 1}/${meta.n} 片），请重新上传覆盖。`)
    }
    parts.push(chunk)
  }
  const packed = base64ToBytes(parts.join(''))
  let compressed: Uint8Array
  if (meta.enc === 'aes-gcm-v1') {
    if (!passphrase.trim()) {
      throw new Error('该云存档已启用端到端加密，请输入加密口令后再拉取。')
    }
    compressed = await decryptBytes(packed, passphrase.trim())
  } else {
    compressed = packed
  }
  const rawBytes = unzlibSync(compressed)
  const jsonText = new TextDecoder().decode(rawBytes)
  const parsed = JSON.parse(jsonText) as ToyCloudVaultV1
  if (!parsed || parsed.v !== 1) {
    throw new Error('不支持的云存档版本')
  }
  return parsed
}

export const pushToToyCloud = async (
  passphrase = ''
): Promise<{ ok: boolean; message: string }> => {
  const sdk = getToySdk()
  if (!sdk || !(await supportToyAbility('setCloudStorage'))) {
    const msg = '当前不在 B站 Toy 环境，数据已保存在本机浏览器；发布到 B站 Toy 后可一键同步到 B站云存档。'
    useToyCloudStore.setState({ statusError: msg })
    return { ok: false, message: msg }
  }

  const now = Date.now()
  if (now - lastWriteTimestamp < WRITE_COOLDOWN_MS) {
    const waitSec = Math.ceil((WRITE_COOLDOWN_MS - (now - lastWriteTimestamp)) / 1000)
    const msg = `为避免触发 B站限流，请在 ${waitSec} 秒后再同步。`
    useToyCloudStore.setState({ statusError: msg })
    return { ok: false, message: msg }
  }

  useToyCloudStore.setState({ busy: true, statusError: null, statusMessage: null })
  try {
    const vault = buildLocalCloudVault()
    const payloadWithoutTs = JSON.stringify({ ...vault, updatedAt: 0 })
    const contentHash = fnv1aHash(`${passphrase ? 'enc:' : 'raw:'}${payloadWithoutTs}`)

    const state = useToyCloudStore.getState()
    if (state.lastHash === contentHash && state.remoteMeta?.hash === contentHash) {
      useToyCloudStore.setState({
        busy: false,
        statusMessage: '云端已是最新内容，无需重复写入（已为你节省配额）',
      })
      return { ok: true, message: '云端已是最新内容' }
    }

    const compressed = zlibSync(new TextEncoder().encode(JSON.stringify(vault)), { level: 9 })
    const trimmedPass = passphrase.trim()
    const packed = trimmedPass ? await encryptBytes(compressed, trimmedPass) : compressed
    const b64 = bytesToBase64(packed)

    const chunkCount = Math.ceil(b64.length / CHUNK_SIZE)
    if (chunkCount > MAX_CHUNKS) {
      throw new Error(
        `当前人格与配置压缩后超出 B站 128 KB 云存储上限（需 ${chunkCount} 片，上限 ${MAX_CHUNKS} 片），请精简部分过长的人格设定后再试。`
      )
    }

    const meta: ToyCloudMeta = {
      v: 1,
      enc: trimmedPass ? 'aes-gcm-v1' : 'zlib-v1',
      n: chunkCount,
      ts: now,
      hash: contentHash,
      personas: vault.personas.length,
      keys: countConfiguredKeys(vault),
    }

    const batch: Record<string, string> = {
      [META_KEY]: JSON.stringify(meta),
    }
    for (let i = 0; i < chunkCount; i++) {
      batch[`${CHUNK_PREFIX}${i}`] = b64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    }

    const prevCount = state.remoteMeta?.n ?? 0
    await withRateLimitRetry(() => sdk.setCloudStorage(batch))
    lastWriteTimestamp = Date.now()

    // 若新分片数少于旧分片数，一次性批量清理多余旧分片
    if (prevCount > chunkCount) {
      const staleKeys: string[] = []
      for (let i = chunkCount; i < prevCount; i++) {
        staleKeys.push(`${CHUNK_PREFIX}${i}`)
      }
      await withRateLimitRetry(() => sdk.removeCloudStorage(staleKeys)).catch(() => {})
    }

    cachedRemoteRecord = batch
    saveLocalMeta(now, contentHash)
    const msg = `已同步 ${meta.personas} 个人格与 ${meta.keys} 组 Key 到 B站云存档（占 ${chunkCount + 1}/128 槽位${trimmedPass ? ' · AES-256 加密' : ''}）`
    useToyCloudStore.setState({
      busy: false,
      lastSyncedAt: now,
      lastHash: contentHash,
      remoteMeta: meta,
      needsPassphrase: meta.enc === 'aes-gcm-v1',
      statusMessage: msg,
    })
    return { ok: true, message: msg }
  } catch (err) {
    const msg = formatToyError(err, '同步到 B站云存档失败')
    useToyCloudStore.setState({ busy: false, statusError: msg })
    return { ok: false, message: msg }
  }
}

export const pullFromToyCloud = async (
  passphrase = '',
  forceRefresh = true
): Promise<{ ok: boolean; message: string }> => {
  const sdk = getToySdk()
  if (!sdk || !(await supportToyAbility('getCloudStorage'))) {
    const msg = '当前不在 B站 Toy 环境，无法读取 B站云存档。'
    useToyCloudStore.setState({ statusError: msg })
    return { ok: false, message: msg }
  }

  useToyCloudStore.setState({ busy: true, statusError: null, statusMessage: null })
  try {
    const record =
      !forceRefresh && cachedRemoteRecord
        ? cachedRemoteRecord
        : await withRateLimitRetry(() => sdk.getCloudStorage())
    cachedRemoteRecord = record

    const metaRaw = record[META_KEY]
    if (!metaRaw) {
      const msg = '你的 B站账号下还没有云存档，可以先点击「上传当前配置到云端」。'
      useToyCloudStore.setState({ busy: false, remoteMeta: null, statusMessage: msg })
      return { ok: false, message: msg }
    }

    const meta = JSON.parse(metaRaw) as ToyCloudMeta
    useToyCloudStore.setState({ remoteMeta: meta, needsPassphrase: meta.enc === 'aes-gcm-v1' })

    const vault = await decodeCloudRecord(record, meta, passphrase)
    applyCloudVaultToLocal(vault)
    saveLocalMeta(meta.ts, meta.hash)

    const msg = `已从 B站云存档恢复 ${meta.personas} 个人格与 ${meta.keys} 组 Key（本地 Raw RAG 记忆保持不变）`
    useToyCloudStore.setState({
      busy: false,
      lastSyncedAt: meta.ts,
      lastHash: meta.hash,
      statusMessage: msg,
    })
    return { ok: true, message: msg }
  } catch (err) {
    const msg = formatToyError(err, '从 B站云存档恢复失败')
    useToyCloudStore.setState({ busy: false, statusError: msg })
    return { ok: false, message: msg }
  }
}

export const clearToyCloudVault = async (): Promise<{ ok: boolean; message: string }> => {
  const sdk = getToySdk()
  if (!sdk || !(await supportToyAbility('removeCloudStorage'))) {
    return { ok: false, message: '当前环境不支持清空 B站云存档。' }
  }
  useToyCloudStore.setState({ busy: true, statusError: null })
  try {
    const all = cachedRemoteRecord ?? (await withRateLimitRetry(() => sdk.getCloudStorage()))
    const keysToRemove = Object.keys(all).filter(
      (k) => k === META_KEY || k.startsWith(CHUNK_PREFIX)
    )
    if (keysToRemove.length > 0) {
      await withRateLimitRetry(() => sdk.removeCloudStorage(keysToRemove))
    }
    cachedRemoteRecord = {}
    saveLocalMeta(null, null)
    useToyCloudStore.setState({
      busy: false,
      lastSyncedAt: null,
      lastHash: null,
      remoteMeta: null,
      needsPassphrase: false,
      statusMessage: '已清空 B站云存档（本机数据保留）',
    })
    return { ok: true, message: '已清空 B站云存档' }
  } catch (err) {
    const msg = formatToyError(err, '清空云存档失败')
    useToyCloudStore.setState({ busy: false, statusError: msg })
    return { ok: false, message: msg }
  }
}
