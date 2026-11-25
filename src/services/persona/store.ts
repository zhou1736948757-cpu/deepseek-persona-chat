import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { setSearch, setThinking, setTtsVoice } from '../settings.js'
import type { Persona, PersonaDraft } from './types.js'

const STORAGE_KEYS = {
  personas: 'chat-demo:personas:v1',
  activeId: 'chat-demo:active-persona:v1',
  onboardingDone: 'chat-demo:onboarding-done:v1',
} as const

export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

const BUILTIN_PERSONAS: Persona[] = [
  {
    id: 'builtin-deepseek',
    name: 'DeepSeek 默认助手',
    avatar: 'DS',
    tagline: '官方原生体验 · 通用问答、联网搜索与深度思考',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    greeting: '今天有什么可以帮到你？',
    memoryNotes: '',
    ttsVoice: 'stella',
    defaultThinking: false,
    defaultSearch: true,
    builtin: true,
    sourceInfo: { kind: 'manual' },
    createdAt: 1735689600000,
    updatedAt: 1735689600000,
  },
  {
    id: 'builtin-companion',
    name: '星野 · 语音陪伴',
    avatar: '🌙',
    tagline: '自然柔和口语 · 适合开启 TTS 语音朗读与日常聊天',
    systemPrompt:
      '你是「星野」，一位温和、真诚、有共情力但不油腻的日常聊天伙伴。说话自然简洁，像朋友发微信一样流畅，适合语音朗读，避免冗长列表与说教；遇到需要查证的实时信息时，可以结合联网搜索给出一针见血的分享。',
    greeting: '嗨，今天过得怎么样？有什么想聊聊的，或者想听我帮你查点什么？',
    memoryNotes: '',
    ttsVoice: 'stella',
    defaultThinking: false,
    defaultSearch: true,
    builtin: true,
    sourceInfo: { kind: 'manual' },
    createdAt: 1735689601000,
    updatedAt: 1735689601000,
  },
  {
    id: 'builtin-researcher',
    name: '暗潮 · 深度研判',
    avatar: '🧭',
    tagline: '默认开启深度思考 + 智能搜索 · 适合复杂分析与资料核查',
    systemPrompt:
      '你是「暗潮」，一位冷静、严谨的研究搭档。回答先给结论，再给关键证据与不确定性边界；擅长利用深度思考和联网搜索拆解复杂问题，不编造来源。',
    greeting: '把你想深挖的问题或资料丢给我，我们一起拆开看。',
    memoryNotes: '',
    ttsVoice: 'tide',
    defaultThinking: true,
    defaultSearch: true,
    builtin: true,
    sourceInfo: { kind: 'manual' },
    createdAt: 1735689602000,
    updatedAt: 1735689602000,
  },
]

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 忽略隐私模式或配额限制
  }
}

const loadInitialPersonas = (): Persona[] => {
  const raw = readStorage(STORAGE_KEYS.personas)
  if (!raw) {
    return BUILTIN_PERSONAS
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return BUILTIN_PERSONAS
    }
    const valid = parsed.filter(
      (item): item is Persona =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Persona).id === 'string' &&
        typeof (item as Persona).name === 'string'
    )
    if (!valid.some((p) => p.id === 'builtin-deepseek')) {
      return [BUILTIN_PERSONAS[0], ...valid]
    }
    return valid
  } catch {
    return BUILTIN_PERSONAS
  }
}

export type PersonaModalTab = 'manage' | 'quiz' | 'import' | 'memory' | 'edit'

type PersonaStoreState = {
  personas: Persona[]
  activePersonaId: string
  onboardingDone: boolean
  onboardingOpen: boolean
  managerOpen: boolean
  managerTab: PersonaModalTab
  editingPersonaId: string | null
}

const initialPersonas = loadInitialPersonas()
const savedActiveId = readStorage(STORAGE_KEYS.activeId)
const initialActiveId =
  savedActiveId && initialPersonas.some((p) => p.id === savedActiveId)
    ? savedActiveId
    : initialPersonas[0].id

export const usePersonaStore = create<PersonaStoreState>(() => ({
  personas: initialPersonas,
  activePersonaId: initialActiveId,
  onboardingDone: readStorage(STORAGE_KEYS.onboardingDone) === 'true',
  onboardingOpen: false,
  managerOpen: false,
  managerTab: 'manage',
  editingPersonaId: null,
}))

const persistPersonas = (personas: Persona[]) => {
  writeStorage(STORAGE_KEYS.personas, JSON.stringify(personas))
}

export const getActivePersona = (): Persona => {
  const { personas, activePersonaId } = usePersonaStore.getState()
  return personas.find((p) => p.id === activePersonaId) ?? personas[0] ?? BUILTIN_PERSONAS[0]
}

/** 构造发往模型的 system 字段（融合当前人格设定、固定记忆摘录与本轮 Raw RAG 召回记忆）。 */
export const buildActiveSystemPrompt = (recalledMemoryBlock = ''): string => {
  const persona = getActivePersona()
  const base = persona.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT
  const parts = [base]
  const memory = persona.memoryNotes.trim()
  if (memory) {
    parts.push(`【角色固定记忆摘录】\n${memory}`)
  }
  if (recalledMemoryBlock.trim()) {
    parts.push(recalledMemoryBlock.trim())
  }
  return parts.join('\n\n')
}

export const selectPersona = (id: string, syncCapabilities = true) => {
  const persona = usePersonaStore.getState().personas.find((p) => p.id === id)
  if (!persona) {
    return
  }
  writeStorage(STORAGE_KEYS.activeId, persona.id)
  usePersonaStore.setState({ activePersonaId: persona.id })
  if (syncCapabilities) {
    setTtsVoice(persona.ttsVoice)
    setThinking(persona.defaultThinking)
    setSearch(persona.defaultSearch)
  }
}

export const createPersona = (draft: PersonaDraft, activate = true): Persona => {
  const now = Date.now()
  const persona: Persona = {
    ...draft,
    id: createId(),
    createdAt: now,
    updatedAt: now,
  }
  const personas = [persona, ...usePersonaStore.getState().personas]
  persistPersonas(personas)
  usePersonaStore.setState({ personas })
  if (activate) {
    selectPersona(persona.id, true)
  }
  return persona
}

export const updatePersona = (id: string, patch: Partial<PersonaDraft>) => {
  const personas = usePersonaStore
    .getState()
    .personas.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p))
  persistPersonas(personas)
  usePersonaStore.setState({ personas })
  if (usePersonaStore.getState().activePersonaId === id) {
    const updated = personas.find((p) => p.id === id)
    if (updated) {
      setTtsVoice(updated.ttsVoice)
      setThinking(updated.defaultThinking)
      setSearch(updated.defaultSearch)
    }
  }
}

export const deletePersona = (id: string) => {
  if (id === 'builtin-deepseek') {
    return
  }
  const state = usePersonaStore.getState()
  const personas = state.personas.filter((p) => p.id !== id)
  persistPersonas(personas)
  const nextActive =
    state.activePersonaId === id ? (personas[0]?.id ?? 'builtin-deepseek') : state.activePersonaId
  writeStorage(STORAGE_KEYS.activeId, nextActive)
  usePersonaStore.setState({
    personas,
    activePersonaId: nextActive,
    editingPersonaId: state.editingPersonaId === id ? null : state.editingPersonaId,
  })
}

export const duplicatePersona = (id: string): Persona | null => {
  const source = usePersonaStore.getState().personas.find((p) => p.id === id)
  if (!source) {
    return null
  }
  return createPersona(
    {
      name: `${source.name}（副本）`,
      avatar: source.avatar,
      tagline: source.tagline,
      systemPrompt: source.systemPrompt,
      greeting: source.greeting,
      memoryNotes: source.memoryNotes,
      ttsVoice: source.ttsVoice,
      defaultThinking: source.defaultThinking,
      defaultSearch: source.defaultSearch,
      sourceInfo: source.sourceInfo,
    },
    false
  )
}

export const openPersonaManager = (tab: PersonaModalTab = 'manage', editingPersonaId?: string) => {
  usePersonaStore.setState({
    managerOpen: true,
    managerTab: tab,
    editingPersonaId: editingPersonaId ?? null,
  })
}

export const closePersonaManager = () => {
  usePersonaStore.setState({ managerOpen: false, editingPersonaId: null })
}

export const openOnboarding = () => {
  usePersonaStore.setState({ onboardingOpen: true })
}

export const closeOnboarding = (markDone = true) => {
  if (markDone) {
    writeStorage(STORAGE_KEYS.onboardingDone, 'true')
  }
  usePersonaStore.setState({
    onboardingOpen: false,
    ...(markDone ? { onboardingDone: true } : {}),
  })
}
