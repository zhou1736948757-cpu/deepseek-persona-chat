import { strFromU8, unzipSync } from 'fflate'
import { createId } from '../../utils/id.js'
import { streamMessage } from '../api/client.js'
import type { TtsVoice } from '../api/speech.js'
import type { AssistantMessage, Message, Session, UserMessage } from '../chat/types.js'
import type {
  ImportedArchiveResult,
  ImportedConversation,
  ImportedMessage,
  Persona,
  PersonaDraft,
} from './types.js'

const parseTimestamp = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJsonUtf8 = (bytes: Uint8Array, label: string): unknown => {
  const raw = strFromU8(bytes).replace(/^\uFEFF/, '')
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${label} 不是有效的 UTF-8 JSON`)
  }
}

const parseV3Session = (
  sessionData: unknown,
  fallbackId: string,
  fallbackTitle: string
): ImportedConversation => {
  if (!isRecord(sessionData)) {
    throw new Error(`会话 ${fallbackId} 数据格式无效`)
  }
  const messagesRaw = Array.isArray(sessionData.messages) ? sessionData.messages : []
  const byId = new Map<number, Record<string, unknown>>()
  for (const item of messagesRaw) {
    if (isRecord(item) && typeof item.id === 'number') {
      byId.set(item.id, item)
    }
  }

  const branch: Record<string, unknown>[] = []
  const currentId = sessionData.current_message_id
  if (typeof currentId === 'number' && byId.has(currentId)) {
    const seen = new Set<number>()
    let cursor: number | null = currentId
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor)
      const node = byId.get(cursor)
      if (!node) {
        break
      }
      branch.push(node)
      cursor = typeof node.parent_id === 'number' ? node.parent_id : null
    }
    branch.reverse()
  }

  const now = Date.now()
  const createdAt = parseTimestamp(sessionData.inserted_at, now)
  const messages: ImportedMessage[] = []
  let skippedCount = 0

  for (const node of branch) {
    const roleRaw = node.role
    if (roleRaw !== 'USER' && roleRaw !== 'ASSISTANT') {
      skippedCount += 1
      continue
    }
    const isUser = roleRaw === 'USER'
    if (!isUser && node.status === 'CONTENT_FILTER') {
      skippedCount += 1
      continue
    }
    const fragments = Array.isArray(node.fragments) ? node.fragments : []
    const expectedType = isUser ? 'REQUEST' : 'RESPONSE'
    const text = fragments
      .filter(
        (frag): frag is { type: string; content: string } =>
          isRecord(frag) && frag.type === expectedType && typeof frag.content === 'string'
      )
      .map((frag) => frag.content)
      .join('')
    if (!text.trim()) {
      skippedCount += 1
      continue
    }
    messages.push({
      id: String(node.id ?? messages.length + 1),
      role: isUser ? 'user' : 'assistant',
      speaker: isUser ? '用户' : 'DeepSeek',
      text,
      createdAt: parseTimestamp(node.inserted_at, createdAt + messages.length * 1000),
    })
  }

  return {
    id: typeof sessionData.id === 'string' ? sessionData.id : fallbackId,
    title:
      typeof sessionData.title === 'string' && sessionData.title.trim()
        ? sessionData.title.trim()
        : fallbackTitle || '未命名会话',
    sourceFormat: 'deepseek-v3-zip',
    userName: '用户',
    characterName: 'DeepSeek',
    createdAt,
    messages,
    skippedCount,
  }
}

const parseV3Zip = (entries: Record<string, Uint8Array>): ImportedConversation[] => {
  const manifestBytes = entries['manifest.json']
  if (!manifestBytes) {
    throw new Error('ZIP 缺少 manifest.json')
  }
  const manifest = parseJsonUtf8(manifestBytes, 'manifest.json')
  if (!isRecord(manifest) || manifest.export_format_version !== 3) {
    throw new Error('仅支持 DeepSeek chat-demo v3 格式（export_format_version = 3）')
  }
  const indexBytes = entries['chat_session_index.json']
  if (!indexBytes) {
    throw new Error('ZIP 缺少 chat_session_index.json')
  }
  const indexRows = parseJsonUtf8(indexBytes, 'chat_session_index.json')
  if (!Array.isArray(indexRows)) {
    throw new Error('chat_session_index.json 格式无效')
  }

  const conversations: ImportedConversation[] = []
  for (const row of indexRows) {
    if (!isRecord(row) || typeof row.id !== 'string') {
      continue
    }
    const entryName = `chat_sessions/${row.id}.json`
    const sessionBytes = entries[entryName]
    if (!sessionBytes) {
      continue
    }
    const sessionData = parseJsonUtf8(sessionBytes, entryName)
    const fallbackTitle = typeof row.title === 'string' ? row.title : row.id
    conversations.push(parseV3Session(sessionData, row.id, fallbackTitle))
  }
  return conversations
}

const inferWebRole = (
  message: Record<string, unknown>,
  fragments: unknown[]
): 'user' | 'assistant' | null => {
  if (typeof message.role === 'string') {
    const upper = message.role.toUpperCase()
    if (upper === 'USER') {
      return 'user'
    }
    if (upper === 'ASSISTANT') {
      return 'assistant'
    }
  }
  const hasRequest = fragments.some((f) => isRecord(f) && f.type === 'REQUEST')
  const hasResponse = fragments.some(
    (f) =>
      isRecord(f) &&
      (f.type === 'RESPONSE' ||
        f.type === 'THINK' ||
        f.type === 'SEARCH' ||
        f.type === 'TOOL_SEARCH' ||
        f.type === 'TEMPLATE_RESPONSE')
  )
  if (hasRequest && !hasResponse) {
    return 'user'
  }
  if (hasResponse && !hasRequest) {
    return 'assistant'
  }
  return hasRequest ? 'user' : null
}

const parseWebConversations = (data: unknown): ImportedConversation[] => {
  if (!Array.isArray(data)) {
    throw new Error('conversations.json 必须是会话数组')
  }
  const now = Date.now()
  const result: ImportedConversation[] = []

  for (let i = 0; i < data.length; i += 1) {
    const conv = data[i]
    if (!isRecord(conv) || !isRecord(conv.mapping)) {
      continue
    }
    const mapping = conv.mapping
    const branch: [string, Record<string, unknown>][] = []
    const currentNode = conv.current_node

    if (typeof currentNode === 'string' && isRecord(mapping[currentNode])) {
      const seen = new Set<string>()
      let cursor: string | null = currentNode
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor)
        const node: unknown = mapping[cursor]
        if (!isRecord(node)) {
          break
        }
        branch.push([cursor, node])
        cursor = typeof node.parent === 'string' ? node.parent : null
      }
      branch.reverse()
    } else {
      const rootKey =
        isRecord(mapping.root) && mapping.root.parent === null
          ? 'root'
          : Object.keys(mapping).find((key) => isRecord(mapping[key]) && mapping[key].parent === null)
      if (rootKey) {
        const seen = new Set<string>()
        let cursor: string | null = rootKey
        while (cursor && !seen.has(cursor)) {
          seen.add(cursor)
          const node: unknown = mapping[cursor]
          if (!isRecord(node)) {
            break
          }
          branch.push([cursor, node])
          const children: unknown[] = Array.isArray(node.children) ? node.children : []
          const next: unknown = children.length > 0 ? children[children.length - 1] : null
          cursor = typeof next === 'string' && isRecord(mapping[next]) ? next : null
        }
      }
    }

    const createdAt = parseTimestamp(conv.inserted_at, now)
    const messages: ImportedMessage[] = []
    let skippedCount = 0

    for (const [nodeId, node] of branch) {
      if (!isRecord(node.message)) {
        continue
      }
      const message = node.message
      const fragments = Array.isArray(message.fragments) ? message.fragments : []
      const role = inferWebRole(message, fragments)
      if (!role) {
        skippedCount += 1
        continue
      }
      if (role === 'assistant' && message.status === 'CONTENT_FILTER') {
        skippedCount += 1
        continue
      }
      const expected = role === 'user' ? 'REQUEST' : 'RESPONSE'
      const text = fragments
        .filter(
          (frag): frag is { type: string; content: string } =>
            isRecord(frag) && frag.type === expected && typeof frag.content === 'string'
        )
        .map((frag) => frag.content)
        .join('')
      if (!text.trim()) {
        skippedCount += 1
        continue
      }
      messages.push({
        id: nodeId,
        role,
        speaker: role === 'user' ? '用户' : 'DeepSeek',
        text,
        createdAt: parseTimestamp(message.inserted_at, createdAt + messages.length * 1000),
      })
    }

    result.push({
      id: typeof conv.id === 'string' ? conv.id : `web-${i + 1}`,
      title:
        typeof conv.title === 'string' && conv.title.trim()
          ? conv.title.trim()
          : `官网会话 ${i + 1}`,
      sourceFormat: 'deepseek-web-export',
      userName: '用户',
      characterName: 'DeepSeek',
      createdAt,
      messages,
      skippedCount,
    })
  }
  return result
}

const parseSillyTavernJsonl = (rawText: string, fileName: string): ImportedConversation[] => {
  const lines = rawText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    throw new Error('JSONL 文件为空')
  }

  let firstObj: unknown
  try {
    firstObj = JSON.parse(lines[0])
  } catch {
    throw new Error('JSONL 首行不是有效的 JSON')
  }
  if (!isRecord(firstObj)) {
    throw new Error('JSONL 首行必须是对象')
  }

  const isHeader =
    'user_name' in firstObj || 'character_name' in firstObj || 'chat_metadata' in firstObj
  const now = Date.now()
  let userName = typeof firstObj.user_name === 'string' && firstObj.user_name.trim()
    ? firstObj.user_name.trim()
    : '用户'
  let characterName =
    typeof firstObj.character_name === 'string' && firstObj.character_name.trim()
      ? firstObj.character_name.trim()
      : 'DeepSeek'
  const createDate = parseTimestamp(firstObj.create_date, now)

  let title = fileName.replace(/\.jsonl$/i, '')
  let sessionId = createId()
  if (isRecord(firstObj.chat_metadata) && isRecord(firstObj.chat_metadata.deepseek)) {
    const ds = firstObj.chat_metadata.deepseek
    if (typeof ds.title === 'string' && ds.title.trim()) {
      title = ds.title.trim()
    }
    if (typeof ds.session_id === 'string' && ds.session_id.trim()) {
      sessionId = ds.session_id.trim()
    }
  }

  const messages: ImportedMessage[] = []
  let skippedCount = 0
  const startIndex = isHeader ? 1 : 0

  for (let i = startIndex; i < lines.length; i += 1) {
    let row: unknown
    try {
      row = JSON.parse(lines[i])
    } catch {
      skippedCount += 1
      continue
    }
    if (!isRecord(row) || row.is_system === true) {
      skippedCount += 1
      continue
    }
    const text = typeof row.mes === 'string' ? row.mes : ''
    if (!text.trim()) {
      skippedCount += 1
      continue
    }
    const isUser = row.is_user === true
    const speaker =
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : isUser
          ? userName
          : characterName
    if (isUser && userName === '用户' && speaker !== '用户') {
      userName = speaker
    }
    if (!isUser && characterName === 'DeepSeek' && speaker !== 'DeepSeek') {
      characterName = speaker
    }
    const extraId =
      isRecord(row.extra) && row.extra.deepseek_message_id !== undefined
        ? String(row.extra.deepseek_message_id)
        : String(i)
    messages.push({
      id: extraId,
      role: isUser ? 'user' : 'assistant',
      speaker,
      text,
      createdAt: parseTimestamp(row.send_date, createDate + messages.length * 1000),
    })
  }

  return [
    {
      id: sessionId,
      title,
      sourceFormat: 'sillytavern-jsonl',
      userName,
      characterName,
      createdAt: createDate,
      messages,
      skippedCount,
    },
  ]
}

const normalizePersonaCard = (raw: Record<string, unknown>, fileName: string): PersonaDraft => {
  const voice: TtsVoice = raw.ttsVoice === 'tide' ? 'tide' : 'stella'
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '导入人格',
    avatar: typeof raw.avatar === 'string' && raw.avatar.trim() ? raw.avatar.trim() : '✨',
    tagline: typeof raw.tagline === 'string' ? raw.tagline.trim() : '从人格文件导入',
    systemPrompt:
      typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()
        ? raw.systemPrompt.trim()
        : typeof raw.description === 'string'
          ? raw.description.trim()
          : '',
    greeting:
      typeof raw.greeting === 'string'
        ? raw.greeting.trim()
        : typeof raw.first_mes === 'string'
          ? raw.first_mes.trim()
          : '',
    memoryNotes: typeof raw.memoryNotes === 'string' ? raw.memoryNotes.trim() : '',
    ttsVoice: voice,
    defaultThinking: Boolean(raw.defaultThinking),
    defaultSearch: raw.defaultSearch !== false,
    sourceInfo: { kind: 'persona-json', fileName },
  }
}

/** 统一解析用户上传的 DeepSeek ZIP（v3 或官网导出）、SillyTavern JSONL 或人格 JSON 文件。 */
export const parseImportFile = async (file: File): Promise<ImportedArchiveResult> => {
  const lower = file.name.toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())

  const isZipMagic =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)

  if (lower.endsWith('.zip') || isZipMagic) {
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(bytes)
    } catch {
      throw new Error('ZIP 文件损坏或无法解压')
    }
    if (entries['manifest.json']) {
      const conversations = parseV3Zip(entries)
      if (conversations.length === 0) {
        throw new Error('v3 ZIP 中未找到任何会话')
      }
      return {
        kind: 'conversations',
        fileName: file.name,
        sourceFormat: 'deepseek-v3-zip',
        conversations,
      }
    }
    const webEntryName = Object.keys(entries).find(
      (name) => name === 'conversations.json' || name.endsWith('/conversations.json')
    )
    if (webEntryName) {
      const data = parseJsonUtf8(entries[webEntryName], webEntryName)
      const conversations = parseWebConversations(data)
      if (conversations.length === 0) {
        throw new Error('conversations.json 中未找到有效会话')
      }
      return {
        kind: 'conversations',
        fileName: file.name,
        sourceFormat: 'deepseek-web-export',
        conversations,
      }
    }
    throw new Error('无法识别该 ZIP：既不包含 chat-demo v3 的 manifest.json，也不包含官网导出的 conversations.json')
  }

  const text = strFromU8(bytes)
  if (lower.endsWith('.jsonl')) {
    const conversations = parseSillyTavernJsonl(text, file.name)
    return {
      kind: 'conversations',
      fileName: file.name,
      sourceFormat: 'sillytavern-jsonl',
      conversations,
    }
  }

  // .json 文件：可能是官网 conversations.json，也可能是人格配置 JSON
  const parsed = parseJsonUtf8(bytes, file.name)
  if (Array.isArray(parsed)) {
    if (parsed.some((item) => isRecord(item) && isRecord(item.mapping))) {
      const conversations = parseWebConversations(parsed)
      return {
        kind: 'conversations',
        fileName: file.name,
        sourceFormat: 'deepseek-web-export',
        conversations,
      }
    }
    const personas = parsed
      .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.name === 'string')
      .map((item) => normalizePersonaCard(item, file.name))
    if (personas.length > 0) {
      return { kind: 'personas', fileName: file.name, personas }
    }
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.personas)) {
      const personas = parsed.personas
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => normalizePersonaCard(item, file.name))
      if (personas.length > 0) {
        return { kind: 'personas', fileName: file.name, personas }
      }
    }
    if (typeof parsed.name === 'string') {
      return {
        kind: 'personas',
        fileName: file.name,
        personas: [normalizePersonaCard(parsed, file.name)],
      }
    }
  }

  throw new Error('不支持的文件格式，请上传 DeepSeek 导出 ZIP、conversations.json、SillyTavern JSONL 或人格 JSON')
}

/** 离线快速从导入对话构造人格草稿（保留角色名、说话风格样本与近期对话记忆）。 */
export const buildPersonaDraftFromConversation = (
  conv: ImportedConversation,
  fileName: string,
  customName?: string
): PersonaDraft => {
  const inferredName =
    customName?.trim() ||
    (conv.characterName && conv.characterName !== 'DeepSeek'
      ? conv.characterName
      : conv.title.replace(/^【虚构】/, '').trim() || '迁移人格')

  const recentExcerpts = conv.messages
    .slice(-10)
    .map((m) => {
      const speaker = m.role === 'user' ? conv.userName || '用户' : inferredName
      const compact = m.text.replace(/\s+/g, ' ').trim()
      const clipped = compact.length > 160 ? `${compact.slice(0, 160)}…` : compact
      return `- ${speaker}：${clipped}`
    })
    .join('\n')

  const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')
  const greeting = lastAssistant
    ? `我们继续吧。我是${inferredName}，还记得之前聊到的「${conv.title}」。`
    : `你好，我是${inferredName}，随时可以开始聊天。`

  const systemPrompt = [
    `你将扮演角色「${inferredName}」，与用户（${conv.userName || '用户'}）保持自然、连贯的对话。`,
    `请延续你在过往对话中的语气、表达节奏与关注点，不要生硬重复模板话术，也不要轻易跳出角色。`,
    `当用户提到过往约定时，优先参考下方的历史记忆摘要。`,
  ].join('\n')

  const memoryNotes = recentExcerpts
    ? `来源会话「${conv.title}」（共 ${conv.messages.length} 条可迁移消息）近期摘录：\n${recentExcerpts}`
    : ''

  return {
    name: inferredName,
    avatar: inferredName.slice(0, 1) || '✨',
    tagline: `迁移自「${conv.title}」· ${conv.messages.length} 条历史消息`,
    systemPrompt,
    greeting,
    memoryNotes,
    ttsVoice: 'stella',
    defaultThinking: false,
    defaultSearch: true,
    sourceInfo: {
      kind: conv.sourceFormat,
      fileName,
      sessionTitle: conv.title,
      importedMessages: conv.messages.length,
    },
  }
}

/** 使用用户已配置的 DeepSeek API Key 从历史对话中智能提炼人格设定与记忆要点。 */
export const distillPersonaWithDeepSeek = async (
  apiKey: string,
  conv: ImportedConversation,
  personaName: string,
  signal: AbortSignal
): Promise<{ tagline: string; systemPrompt: string; memoryNotes: string; greeting: string }> => {
  const transcript = conv.messages
    .slice(-30)
    .map((m) => `[${m.role === 'user' ? conv.userName : personaName}]: ${m.text}`)
    .join('\n\n')
    .slice(0, 12000)

  const instruction = [
    '你是一个角色设定与记忆提炼助手。请根据下方历史对话，为角色提炼可直接用于聊天系统的设定，严格返回合法 JSON（不要 Markdown 代码块）：',
    '{"tagline":"一句话角色简介（20字内）","systemPrompt":"完整的角色系统提示词（包含性格、说话风格、称呼方式、边界与相处模式）","memoryNotes":"3-6条用换行分隔的关键历史记忆与偏好","greeting":"一句自然贴合角色口吻的开场白"}',
  ].join('\n')

  let raw = ''
  const events = streamMessage(
    apiKey,
    {
      model: 'deepseek-flash',
      system: instruction,
      messages: [
        {
          role: 'user',
          content: `角色名：${personaName}\n会话标题：${conv.title}\n\n历史对话：\n${transcript}`,
        },
      ],
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
  const parsed: unknown = JSON.parse(cleaned)
  if (!isRecord(parsed)) {
    throw new Error('模型返回格式异常')
  }
  return {
    tagline: typeof parsed.tagline === 'string' ? parsed.tagline.trim() : '',
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt.trim() : '',
    memoryNotes: typeof parsed.memoryNotes === 'string' ? parsed.memoryNotes.trim() : '',
    greeting: typeof parsed.greeting === 'string' ? parsed.greeting.trim() : '',
  }
}

/** 将导入的对话转换为 chat-demo 本地 Session，可直接追加进左侧历史继续聊。 */
export const toLocalChatSession = (
  conv: ImportedConversation,
  personaName?: string,
  personaId?: string
): Session => {
  const messages: Message[] = []
  let prevId: string | null = null

  for (const item of conv.messages) {
    const id = createId()
    if (item.role === 'user') {
      const msg: UserMessage = {
        id,
        role: 'user',
        content: item.text,
        files: [],
        createdAt: item.createdAt,
        parentId: prevId,
      }
      messages.push(msg)
    } else {
      const msg: AssistantMessage = {
        id,
        role: 'assistant',
        createdAt: item.createdAt,
        model: null,
        prefix: false,
        status: 'done',
        blocks: [{ type: 'text', text: item.text }],
        parentId: prevId,
      }
      messages.push(msg)
    }
    prevId = id
  }

  for (let i = 0; i + 1 < messages.length; i += 1) {
    messages[i].selectedChildId = messages[i + 1].id
  }

  const firstTime = messages[0]?.createdAt ?? conv.createdAt
  const lastTime = messages.at(-1)?.createdAt ?? firstTime
  const prefix = personaName && personaName !== 'DeepSeek' ? `[${personaName}] ` : ''

  return {
    id: createId(),
    title: `${prefix}${conv.title}`,
    createdAt: firstTime,
    updatedAt: Math.max(lastTime, Date.now()),
    ...(personaId ? { personaId } : {}),
    messages,
    rootMessageId: messages[0]?.id ?? null,
  }
}

/** 导出单个人格为可分享/备份的 JSON 文件内容。 */
export const serializePersonaJson = (persona: Persona): string =>
  JSON.stringify(
    {
      format: 'deepseek-persona-v1',
      name: persona.name,
      avatar: persona.avatar,
      tagline: persona.tagline,
      systemPrompt: persona.systemPrompt,
      greeting: persona.greeting,
      memoryNotes: persona.memoryNotes,
      ttsVoice: persona.ttsVoice,
      defaultThinking: persona.defaultThinking,
      defaultSearch: persona.defaultSearch,
    },
    null,
    2
  )
