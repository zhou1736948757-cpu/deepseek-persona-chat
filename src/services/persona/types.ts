import type { TtsVoice } from '../api/speech.js'

export type PersonaSourceKind =
  | 'manual'
  | 'deepseek-v3-zip'
  | 'deepseek-web-export'
  | 'sillytavern-jsonl'
  | 'persona-json'

export type PersonaSourceInfo = {
  kind: PersonaSourceKind
  fileName?: string
  sessionTitle?: string
  importedMessages?: number
}

export type Persona = {
  id: string
  name: string
  avatar: string
  tagline: string
  systemPrompt: string
  greeting: string
  memoryNotes: string
  ttsVoice: TtsVoice
  defaultThinking: boolean
  defaultSearch: boolean
  builtin?: boolean
  sourceInfo?: PersonaSourceInfo
  createdAt: number
  updatedAt: number
}

export type PersonaDraft = Omit<Persona, 'id' | 'createdAt' | 'updatedAt' | 'builtin'>

export type ImportedMessage = {
  id: string
  role: 'user' | 'assistant'
  speaker: string
  text: string
  createdAt: number
}

export type ImportedConversationFormat =
  | 'deepseek-v3-zip'
  | 'deepseek-web-export'
  | 'sillytavern-jsonl'

export type ImportedConversation = {
  id: string
  title: string
  sourceFormat: ImportedConversationFormat
  userName: string
  characterName: string
  createdAt: number
  messages: ImportedMessage[]
  skippedCount: number
}

export type ImportedArchiveResult =
  | {
      kind: 'conversations'
      fileName: string
      sourceFormat: ImportedConversationFormat
      conversations: ImportedConversation[]
    }
  | {
      kind: 'personas'
      fileName: string
      personas: PersonaDraft[]
    }
