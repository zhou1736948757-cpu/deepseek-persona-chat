import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { streamMessage } from '../api/client.js'
import type { ImportedConversation } from '../persona/types.js'

const CONFIG_KEY = 'chat-demo:raw-rag-config:v1'
const DB_NAME = 'chat-demo-raw-rag'
const DB_VERSION = 1

export const SILICONFLOW_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'
export const SILICONFLOW_FREE_EMBEDDING_MODELS = [
  {
    id: 'BAAI/bge-m3',
    label: 'BAAI/bge-m3（推荐 · 免费 · 多语言 8192 tokens）',
  },
  {
    id: 'BAAI/bge-large-zh-v1.5',
    label: 'BAAI/bge-large-zh-v1.5（免费 · 中文增强 512 tokens）',
  },
  {
    id: 'netease-youdao/bce-embedding-base_v1',
    label: 'netease-youdao/bce-embedding-base_v1（免费 · 中英双语）',
  },
] as const

export type EmbeddingProfile = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  fetchedModels: string[]
}

export const EMBEDDING_TEMPLATES: Omit<EmbeddingProfile, 'id' | 'apiKey' | 'fetchedModels'>[] = [
  {
    name: '硅基流动免费向量（默认）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'BAAI/bge-m3',
  },
  {
    name: 'Ollama 本地向量（免 Key）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'bge-m3',
  },
  {
    name: 'OpenAI / 兼容中转向量',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
  },
]

export type MemoryChunk = {
  id: string
  personaId: string
  text: string
  sourceTitle: string
  createdAt: number
  embedding?: number[]
  embeddingModel?: string
}

export type RawRagConfig = {
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
  lastAgentNote: string
}

export type RetrievedMemory = {
  chunk: MemoryChunk
  score: number
  mode: 'hybrid-vector' | 'local-bm25'
  vectorScore?: number
  bm25Score?: number
}

interface RawRagDB extends DBSchema {
  chunks: {
    key: string
    value: MemoryChunk
    indexes: { personaId: string }
  }
}

const DEFAULT_EMBEDDING_PROFILES: EmbeddingProfile[] = [
  {
    id: 'embed-siliconflow',
    name: '硅基流动免费向量（默认）',
    baseUrl: SILICONFLOW_DEFAULT_BASE_URL,
    apiKey: '',
    model: 'BAAI/bge-m3',
    fetchedModels: SILICONFLOW_FREE_EMBEDDING_MODELS.map((m) => m.id),
  },
  {
    id: 'embed-ollama',
    name: 'Ollama 本地向量（免 Key）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'bge-m3',
    fetchedModels: ['bge-m3', 'nomic-embed-text', 'mxbai-embed-large'],
  },
]

const DEFAULT_CONFIG: RawRagConfig = {
  enabled: true,
  autoIngest: true,
  topK: 4,
  minScore: 0.12,
  maxChunkChars: 650,
  siliconFlowApiKey: null,
  embeddingBaseUrl: SILICONFLOW_DEFAULT_BASE_URL,
  embeddingModel: 'BAAI/bge-m3',
  embeddingProfiles: DEFAULT_EMBEDDING_PROFILES,
  activeEmbeddingProfileId: DEFAULT_EMBEDDING_PROFILES[0].id,
  lastAgentNote: '',
}

const loadConfig = (): RawRagConfig => {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) {
      return DEFAULT_CONFIG
    }
    const parsed = JSON.parse(raw) as Partial<RawRagConfig>
    const embeddingBaseUrl =
      typeof parsed.embeddingBaseUrl === 'string' && parsed.embeddingBaseUrl.trim()
        ? parsed.embeddingBaseUrl.trim()
        : DEFAULT_CONFIG.embeddingBaseUrl
    const embeddingModel =
      typeof parsed.embeddingModel === 'string' && parsed.embeddingModel.trim()
        ? parsed.embeddingModel.trim()
        : DEFAULT_CONFIG.embeddingModel

    const profiles =
      Array.isArray(parsed.embeddingProfiles) && parsed.embeddingProfiles.length > 0
        ? parsed.embeddingProfiles
        : DEFAULT_EMBEDDING_PROFILES.map((p, idx) =>
            idx === 0
              ? {
                  ...p,
                  apiKey: parsed.siliconFlowApiKey ?? '',
                  baseUrl: embeddingBaseUrl,
                  model: embeddingModel,
                }
              : p
          )
    const activeId =
      typeof parsed.activeEmbeddingProfileId === 'string' &&
      profiles.some((p) => p.id === parsed.activeEmbeddingProfileId)
        ? parsed.activeEmbeddingProfileId
        : profiles[0].id

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      topK:
        typeof parsed.topK === 'number' && parsed.topK >= 1 && parsed.topK <= 12
          ? parsed.topK
          : DEFAULT_CONFIG.topK,
      minScore:
        typeof parsed.minScore === 'number' && parsed.minScore >= 0 && parsed.minScore <= 1
          ? parsed.minScore
          : DEFAULT_CONFIG.minScore,
      maxChunkChars:
        typeof parsed.maxChunkChars === 'number' &&
        parsed.maxChunkChars >= 200 &&
        parsed.maxChunkChars <= 2000
          ? parsed.maxChunkChars
          : DEFAULT_CONFIG.maxChunkChars,
      embeddingBaseUrl,
      embeddingModel,
      embeddingProfiles: profiles,
      activeEmbeddingProfileId: activeId,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export const useRawRagConfig = create<RawRagConfig>(() => loadConfig())

export const updateRawRagConfig = (patch: Partial<RawRagConfig>) => {
  const prev = useRawRagConfig.getState()
  const next = { ...prev, ...patch }
  // 同步当前激活配置档的字段，保持与 CC-Switch 视图一致
  if (
    patch.siliconFlowApiKey !== undefined ||
    patch.embeddingBaseUrl !== undefined ||
    patch.embeddingModel !== undefined
  ) {
    next.embeddingProfiles = next.embeddingProfiles.map((p) =>
      p.id === next.activeEmbeddingProfileId
        ? {
            ...p,
            ...(patch.siliconFlowApiKey !== undefined ? { apiKey: patch.siliconFlowApiKey ?? '' } : {}),
            ...(patch.embeddingBaseUrl !== undefined ? { baseUrl: patch.embeddingBaseUrl } : {}),
            ...(patch.embeddingModel !== undefined ? { model: patch.embeddingModel } : {}),
          }
        : p
    )
  }
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  } catch {
    // 忽略本地存储写入异常
  }
  useRawRagConfig.setState(next)
}

export const getActiveEmbeddingProfile = (): EmbeddingProfile => {
  const { embeddingProfiles, activeEmbeddingProfileId } = useRawRagConfig.getState()
  return (
    embeddingProfiles.find((p) => p.id === activeEmbeddingProfileId) ??
    embeddingProfiles[0] ??
    DEFAULT_EMBEDDING_PROFILES[0]
  )
}

export const activateEmbeddingProfile = (id: string) => {
  const state = useRawRagConfig.getState()
  const target = state.embeddingProfiles.find((p) => p.id === id)
  if (!target) {
    return
  }
  updateRawRagConfig({
    activeEmbeddingProfileId: target.id,
    embeddingBaseUrl: target.baseUrl,
    embeddingModel: target.model,
    siliconFlowApiKey: target.apiKey || null,
  })
}

export const addEmbeddingProfile = (
  draft: Omit<EmbeddingProfile, 'id' | 'fetchedModels'> & { fetchedModels?: string[] }
): EmbeddingProfile => {
  const profile: EmbeddingProfile = {
    id: createId(),
    name: draft.name.trim() || '自定义向量源',
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
    fetchedModels: draft.fetchedModels ?? (draft.model.trim() ? [draft.model.trim()] : []),
  }
  const state = useRawRagConfig.getState()
  updateRawRagConfig({
    embeddingProfiles: [profile, ...state.embeddingProfiles],
    activeEmbeddingProfileId: profile.id,
    embeddingBaseUrl: profile.baseUrl,
    embeddingModel: profile.model,
    siliconFlowApiKey: profile.apiKey || null,
  })
  return profile
}

export const updateEmbeddingProfile = (id: string, patch: Partial<EmbeddingProfile>) => {
  const state = useRawRagConfig.getState()
  const embeddingProfiles = state.embeddingProfiles.map((p) =>
    p.id === id ? { ...p, ...patch } : p
  )
  const isActive = state.activeEmbeddingProfileId === id
  const updated = embeddingProfiles.find((p) => p.id === id)
  updateRawRagConfig({
    embeddingProfiles,
    ...(isActive && updated
      ? {
          embeddingBaseUrl: updated.baseUrl,
          embeddingModel: updated.model,
          siliconFlowApiKey: updated.apiKey || null,
        }
      : {}),
  })
}

export const deleteEmbeddingProfile = (id: string) => {
  const state = useRawRagConfig.getState()
  const embeddingProfiles = state.embeddingProfiles.filter((p) => p.id !== id)
  if (embeddingProfiles.length === 0) {
    return
  }
  const nextActive =
    state.activeEmbeddingProfileId === id
      ? embeddingProfiles[0]
      : (embeddingProfiles.find((p) => p.id === state.activeEmbeddingProfileId) ?? embeddingProfiles[0])
  updateRawRagConfig({
    embeddingProfiles,
    activeEmbeddingProfileId: nextActive.id,
    embeddingBaseUrl: nextActive.baseUrl,
    embeddingModel: nextActive.model,
    siliconFlowApiKey: nextActive.apiKey || null,
  })
}

/** 一键拉取向量模型列表（自动把含 embed/bge/bce/gte/e5/nomic 的向量模型排在最前面）。 */
export const fetchEmbeddingModelsFromEndpoint = async (
  baseUrl: string,
  apiKey = ''
): Promise<string[]> => {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  if (!cleanBase) {
    throw new Error('请先填写向量接口 Base URL')
  }
  const headers: Record<string, string> = {}
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }
  const response = await fetch(`${cleanBase}/models`, { method: 'GET', headers })
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`拉取向量模型失败 (${response.status})：${text.slice(0, 160)}`)
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
  const isEmbed = (id: string) => /(embed|bge|bce|gte|e5|nomic|mxbai|jina-embed)/i.test(id)
  return [...ids.filter(isEmbed), ...ids.filter((id) => !isEmbed(id))]
}

/** 当前向量配置是否具备调用条件（本机地址如 Ollama 允许免 Key，云端需 API Key）。 */
export const isEmbeddingEndpointReady = (config: RawRagConfig): boolean => {
  if (!config.embeddingBaseUrl.trim() || !config.embeddingModel.trim()) {
    return false
  }
  if (config.siliconFlowApiKey?.trim()) {
    return true
  }
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(config.embeddingBaseUrl.trim())
}

let dbPromise: Promise<IDBPDatabase<RawRagDB>> | null = null

const getDB = () =>
  (dbPromise ??= openDB<RawRagDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('chunks')) {
        const store = db.createObjectStore('chunks', { keyPath: 'id' })
        store.createIndex('personaId', 'personaId', { unique: false })
      }
    },
  }).catch((err: unknown) => {
    dbPromise = null
    throw err
  }))

export const listMemoryChunks = async (personaId: string): Promise<MemoryChunk[]> => {
  const db = await getDB()
  const items = await db.getAllFromIndex('chunks', 'personaId', personaId)
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export const deleteMemoryChunk = async (id: string): Promise<void> => {
  const db = await getDB()
  await db.delete('chunks', id)
}

export const clearPersonaMemory = async (personaId: string): Promise<void> => {
  const db = await getDB()
  const tx = db.transaction('chunks', 'readwrite')
  const keys = await tx.store.index('personaId').getAllKeys(personaId)
  await Promise.all([...keys.map((key) => tx.store.delete(key)), tx.done])
}

export const saveMemoryChunks = async (chunks: MemoryChunk[]): Promise<void> => {
  if (chunks.length === 0) {
    return
  }
  const db = await getDB()
  const tx = db.transaction('chunks', 'readwrite')
  await Promise.all([...chunks.map((c) => tx.store.put(c)), tx.done])
}

const splitIntoRawChunks = (text: string, maxChars: number): string[] => {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }
  if (trimmed.length <= maxChars) {
    return [trimmed]
  }
  const result: string[] = []
  const overlap = Math.min(80, Math.floor(maxChars / 6))
  let start = 0
  while (start < trimmed.length) {
    const end = Math.min(trimmed.length, start + maxChars)
    result.push(trimmed.slice(start, end))
    if (end >= trimmed.length) {
      break
    }
    start = end - overlap
  }
  return result
}

/** 将导入会话按原始问答轮次切分为 Raw RAG 记忆块并写入本地 IndexedDB。 */
export const ingestConversationToRawRag = async (
  personaId: string,
  conv: ImportedConversation,
  personaName?: string
): Promise<MemoryChunk[]> => {
  const { maxChunkChars } = useRawRagConfig.getState()
  const chunks: MemoryChunk[] = []
  const charLabel = personaName?.trim() || conv.characterName || '助手'
  const userLabel = conv.userName || '用户'

  let i = 0
  while (i < conv.messages.length) {
    const current = conv.messages[i]
    const next = conv.messages[i + 1]
    let combined = ''
    let timestamp = current.createdAt
    if (current.role === 'user' && next?.role === 'assistant') {
      combined = `${userLabel}：${current.text.trim()}\n${charLabel}：${next.text.trim()}`
      timestamp = next.createdAt
      i += 2
    } else {
      const label = current.role === 'user' ? userLabel : charLabel
      combined = `${label}：${current.text.trim()}`
      i += 1
    }
    for (const piece of splitIntoRawChunks(combined, maxChunkChars)) {
      chunks.push({
        id: createId(),
        personaId,
        text: piece,
        sourceTitle: conv.title,
        createdAt: timestamp,
      })
    }
  }

  await saveMemoryChunks(chunks)
  return chunks
}

/** 将实时聊天的一轮新对话直接追加到本地 Raw RAG 记忆库。 */
export const ingestExchangeToRawRag = async (
  personaId: string,
  userText: string,
  assistantText: string,
  sourceTitle: string,
  personaName: string
): Promise<void> => {
  const config = useRawRagConfig.getState()
  if (!config.enabled || !config.autoIngest) {
    return
  }
  const u = userText.trim()
  const a = assistantText.trim()
  if (!u && !a) {
    return
  }
  const combined = `${u ? `用户：${u}\n` : ''}${a ? `${personaName}：${a}` : ''}`.trim()
  const pieces = splitIntoRawChunks(combined, config.maxChunkChars)
  const now = Date.now()
  const chunks: MemoryChunk[] = pieces.map((text) => ({
    id: createId(),
    personaId,
    text,
    sourceTitle: sourceTitle || '日常对话',
    createdAt: now,
  }))

  if (isEmbeddingEndpointReady(config)) {
    try {
      const vectors = await fetchEmbeddings(
        config.siliconFlowApiKey ?? '',
        config.embeddingBaseUrl,
        config.embeddingModel,
        chunks.map((c) => c.text)
      )
      chunks.forEach((chunk, idx) => {
        if (vectors[idx]) {
          chunk.embedding = vectors[idx]
          chunk.embeddingModel = config.embeddingModel
        }
      })
    } catch {
      // 向量化失败不阻断原始文本落盘，仍可被本地 BM25 召回
    }
  }
  await saveMemoryChunks(chunks)
}

/** 手动添加一条原始记忆文本到本地 Raw RAG 记忆库。 */
export const addManualMemoryChunk = async (
  personaId: string,
  text: string,
  sourceTitle = '手动补充记忆'
): Promise<MemoryChunk> => {
  const config = useRawRagConfig.getState()
  const chunk: MemoryChunk = {
    id: createId(),
    personaId,
    text: text.trim(),
    sourceTitle,
    createdAt: Date.now(),
  }
  if (isEmbeddingEndpointReady(config) && chunk.text) {
    try {
      const [vec] = await fetchEmbeddings(
        config.siliconFlowApiKey ?? '',
        config.embeddingBaseUrl,
        config.embeddingModel,
        [chunk.text]
      )
      if (vec) {
        chunk.embedding = vec
        chunk.embeddingModel = config.embeddingModel
      }
    } catch {
      // 保留原始文本
    }
  }
  await saveMemoryChunks([chunk])
  return chunk
}

/** 调用硅基流动（或兼容 OpenAI Embeddings 接口）生成文本向量。 */
export const fetchEmbeddings = async (
  apiKey: string,
  baseUrl: string,
  model: string,
  inputs: string[],
  signal?: AbortSignal
): Promise<number[][]> => {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }
  const response = await fetch(`${cleanBase}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input: inputs,
      encoding_format: 'float',
    }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`向量接口返回 ${response.status}：${text.slice(0, 180)}`)
  }
  const body = (await response.json()) as {
    data?: { embedding?: number[]; index?: number }[]
  }
  if (!Array.isArray(body.data)) {
    throw new Error('向量接口响应缺少 data 数组')
  }
  const sorted = [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  return sorted.map((item) => {
    if (!Array.isArray(item.embedding)) {
      throw new Error('向量接口返回的 embedding 无效')
    }
    return item.embedding
  })
}

export const testSiliconFlowEmbedding = async (
  apiKey: string,
  baseUrl = SILICONFLOW_DEFAULT_BASE_URL,
  model = 'BAAI/bge-m3'
): Promise<{ dimensions: number }> => {
  const vectors = await fetchEmbeddings(apiKey, baseUrl, model, ['硅基流动免费向量模型连通性测试'])
  const first = vectors[0]
  if (!first || first.length === 0) {
    throw new Error('未返回有效向量')
  }
  return { dimensions: first.length }
}

/** 为指定人格下尚未向量化（或切换模型后过期）的记忆块批量建立硅基流动向量索引。 */
export const embedPersonaMemoryChunks = async (
  personaId: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ embedded: number; total: number }> => {
  const config = useRawRagConfig.getState()
  if (!isEmbeddingEndpointReady(config)) {
    throw new Error('请先填写向量接口 API Key（或切换为本机 Ollama 向量接口）')
  }
  const all = await listMemoryChunks(personaId)
  const pending = all.filter(
    (c) => !c.embedding || c.embedding.length === 0 || c.embeddingModel !== config.embeddingModel
  )
  if (pending.length === 0) {
    return { embedded: 0, total: all.length }
  }

  const batchSize = 16
  let done = 0
  onProgress?.(0, pending.length)
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)
    const vectors = await fetchEmbeddings(
      config.siliconFlowApiKey ?? '',
      config.embeddingBaseUrl,
      config.embeddingModel,
      batch.map((c) => c.text)
    )
    const updated = batch.map((chunk, idx) => ({
      ...chunk,
      embedding: vectors[idx],
      embeddingModel: config.embeddingModel,
    }))
    await saveMemoryChunks(updated)
    done += batch.length
    onProgress?.(done, pending.length)
  }
  return { embedded: done, total: all.length }
}

/** 中英文混合分词（英文词 + 中文单字/双字 bigram），保证零配置离线 BM25 对中文同样精准。 */
const tokenize = (text: string): string[] => {
  const normalized = text.toLowerCase()
  const tokens: string[] = []
  const latinMatches = normalized.match(/[a-z0-9_]+/g)
  if (latinMatches) {
    tokens.push(...latinMatches)
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fff]+/g)
  if (cjkRuns) {
    for (const run of cjkRuns) {
      for (let i = 0; i < run.length; i += 1) {
        tokens.push(run[i])
        if (i + 1 < run.length) {
          tokens.push(run.slice(i, i + 2))
        }
      }
    }
  }
  return tokens
}

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) {
    return 0
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

const scoreBm25 = (queryTokens: string[], docs: string[][]): number[] => {
  const n = docs.length
  if (n === 0 || queryTokens.length === 0) {
    return docs.map(() => 0)
  }
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / n || 1
  const df = new Map<string, number>()
  for (const doc of docs) {
    for (const token of new Set(doc)) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }
  const k1 = 1.5
  const b = 0.75
  const uniqueQuery = [...new Set(queryTokens)]

  const rawScores = docs.map((doc) => {
    const tf = new Map<string, number>()
    for (const token of doc) {
      tf.set(token, (tf.get(token) ?? 0) + 1)
    }
    let score = 0
    for (const qt of uniqueQuery) {
      const freq = tf.get(qt) ?? 0
      if (freq === 0) {
        continue
      }
      const docFreq = df.get(qt) ?? 0
      const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5))
      score += idf * ((freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * doc.length) / avgLen)))
    }
    return score
  })

  const maxScore = Math.max(...rawScores, 0)
  return maxScore > 0 ? rawScores.map((s) => s / maxScore) : rawScores
}

/**
 * Raw RAG 检索：
 * - 若已配置硅基流动 Key 且存在匹配向量：使用 0.72 * 向量余弦 + 0.28 * BM25 混合召回；
 * - 否则零配置降级为纯本地 BM25 召回，开箱即用。
 */
export const retrieveRawMemory = async (
  personaId: string,
  query: string,
  overrideTopK?: number
): Promise<RetrievedMemory[]> => {
  const config = useRawRagConfig.getState()
  if (!config.enabled || !query.trim()) {
    return []
  }
  const chunks = await listMemoryChunks(personaId)
  if (chunks.length === 0) {
    return []
  }

  const queryTokens = tokenize(query)
  const docTokens = chunks.map((c) => tokenize(c.text))
  const bm25Scores = scoreBm25(queryTokens, docTokens)

  let queryVector: number[] | null = null
  const hasMatchingVectors =
    isEmbeddingEndpointReady(config) &&
    chunks.some((c) => c.embedding && c.embeddingModel === config.embeddingModel)

  if (hasMatchingVectors) {
    try {
      const [vec] = await fetchEmbeddings(
        config.siliconFlowApiKey ?? '',
        config.embeddingBaseUrl,
        config.embeddingModel,
        [query.trim()]
      )
      queryVector = vec ?? null
    } catch {
      queryVector = null
    }
  }

  const scored: RetrievedMemory[] = chunks.map((chunk, idx) => {
    const bm25 = bm25Scores[idx] ?? 0
    if (queryVector && chunk.embedding && chunk.embeddingModel === config.embeddingModel) {
      const vecScore = Math.max(0, cosineSimilarity(queryVector, chunk.embedding))
      return {
        chunk,
        score: vecScore * 0.72 + bm25 * 0.28,
        mode: 'hybrid-vector',
        vectorScore: vecScore,
        bm25Score: bm25,
      }
    }
    return {
      chunk,
      score: bm25,
      mode: 'local-bm25',
      bm25Score: bm25,
    }
  })

  const limit = overrideTopK ?? config.topK
  return scored
    .filter((item) => item.score >= config.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** 将召回的 Raw RAG 片段格式化为可拼接进 system prompt 的上下文段。 */
export const formatRecalledMemoryBlock = (recalled: RetrievedMemory[]): string => {
  if (recalled.length === 0) {
    return ''
  }
  const lines = recalled.map((item, idx) => {
    const tag = item.mode === 'hybrid-vector' ? '向量+BM25' : '本地BM25'
    return `[记忆#${idx + 1} · 来源:${item.chunk.sourceTitle} · ${tag} ${(item.score * 100).toFixed(0)}%]\n${item.chunk.text}`
  })
  return `【本地 Raw RAG 召回的相关原始历史记忆（按相关度排序，自然参考即可，勿生硬复读）】\n${lines.join('\n\n')}`
}

/**
 * 使用用户的 DeepSeek API Key 作为配置 Agent，根据当前本地记忆特征自动推荐并应用最优 Raw RAG 参数。
 */
export const configureRawRagWithDeepSeekAgent = async (
  deepseekApiKey: string,
  personaId: string,
  signal: AbortSignal
): Promise<{ applied: Partial<RawRagConfig>; reason: string }> => {
  const current = useRawRagConfig.getState()
  const chunks = await listMemoryChunks(personaId)
  const avgChars =
    chunks.length > 0
      ? Math.round(chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length)
      : 0
  const embeddedCount = chunks.filter(
    (c) => c.embedding && c.embeddingModel === current.embeddingModel
  ).length
  const samplePreview = chunks
    .slice(0, 4)
    .map((c) => c.text.slice(0, 120))
    .join('\n---\n')

  const systemPrompt = [
    '你是一个本地 Raw RAG 记忆配置 Agent。请根据用户的本地聊天记忆统计数据，给出最合适、零负担的 Raw RAG 参数。',
    '严格只返回一段合法 JSON（不要 Markdown 代码块）：',
    '{"topK":4,"minScore":0.15,"maxChunkChars":650,"autoIngest":true,"embeddingModel":"BAAI/bge-m3","reason":"不超过50字的中文配置理由"}',
    '约束：topK 在 2-8 之间；minScore 在 0.08-0.45 之间；maxChunkChars 在 350-1200 之间；embeddingModel 优先推荐硅基流动免费模型 BAAI/bge-m3。',
  ].join('\n')

  const userPrompt = [
    `当前记忆总数：${chunks.length} 条`,
    `已向量化条数：${embeddedCount} 条`,
    `平均单块字数：${avgChars} 字`,
    `是否已填硅基流动 Key：${current.siliconFlowApiKey ? '是' : '否（当前走本地 BM25 兜底）'}`,
    samplePreview ? `记忆样本：\n${samplePreview}` : '暂无历史记忆样本（新用户冷启动）',
  ].join('\n')

  let raw = ''
  const events = streamMessage(
    deepseekApiKey,
    {
      model: 'deepseek-flash',
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      thinking: { type: 'disabled' },
      tools: [],
      safety_check: { level: 'high' },
    },
    signal
  )
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      raw += event.delta.text
    }
  }

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned) as Record<string, unknown>

  const topK =
    typeof parsed.topK === 'number' ? Math.max(2, Math.min(8, Math.round(parsed.topK))) : 4
  const minScore =
    typeof parsed.minScore === 'number'
      ? Math.max(0.08, Math.min(0.45, Number(parsed.minScore.toFixed(2))))
      : 0.15
  const maxChunkChars =
    typeof parsed.maxChunkChars === 'number'
      ? Math.max(350, Math.min(1200, Math.round(parsed.maxChunkChars)))
      : 650
  const autoIngest = typeof parsed.autoIngest === 'boolean' ? parsed.autoIngest : true
  const validModels: string[] = SILICONFLOW_FREE_EMBEDDING_MODELS.map((m) => m.id)
  const embeddingModel =
    typeof parsed.embeddingModel === 'string' && validModels.includes(parsed.embeddingModel)
      ? parsed.embeddingModel
      : 'BAAI/bge-m3'
  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : '已按当前记忆规模优化召回数量与阈值。'

  const applied: Partial<RawRagConfig> = {
    enabled: true,
    topK,
    minScore,
    maxChunkChars,
    autoIngest,
    embeddingModel,
    lastAgentNote: reason,
  }
  updateRawRagConfig(applied)
  return { applied, reason }
}
