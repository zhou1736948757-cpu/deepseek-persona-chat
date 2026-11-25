import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TtsVoice } from '../../services/api/speech.js'
import { appendImportedSession } from '../../services/chat/store.js'
import {
  addManualMemoryChunk,
  clearPersonaMemory,
  configureRawRagWithDeepSeekAgent,
  deleteMemoryChunk,
  embedPersonaMemoryChunks,
  ingestConversationToRawRag,
  listMemoryChunks,
  retrieveRawMemory,
  SILICONFLOW_FREE_EMBEDDING_MODELS,
  updateRawRagConfig,
  useRawRagConfig,
  type MemoryChunk,
  type RetrievedMemory,
} from '../../services/memory/rawRag.js'
import {
  buildPersonaDraftFromConversation,
  distillPersonaWithDeepSeek,
  parseImportFile,
  serializePersonaJson,
  toLocalChatSession,
} from '../../services/persona/importers.js'
import {
  closePersonaManager,
  createPersona,
  deletePersona,
  duplicatePersona,
  getActivePersona,
  openOnboarding,
  openPersonaManager,
  selectPersona,
  updatePersona,
  usePersonaStore,
} from '../../services/persona/store.js'
import type {
  ImportedArchiveResult,
  ImportedConversation,
  Persona,
  PersonaDraft,
} from '../../services/persona/types.js'
import { useSettings } from '../../services/settings.js'
import { describeReadAloudError, toggleReadAloud } from '../../services/speech/readAloud.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { PersonaQuestionnaireTab } from './PersonaQuestionnaireTab.js'
import styles from './Persona.module.css'

const SOURCE_LABELS: Record<string, string> = {
  'deepseek-v3-zip': 'DeepSeek v3 ZIP',
  'deepseek-web-export': 'DeepSeek 官网导出',
  'sillytavern-jsonl': 'SillyTavern JSONL',
  'persona-json': '人格 JSON',
  manual: '手动创建',
}

const DEMO_CONVERSATION: ImportedConversation = {
  id: 'demo-main',
  title: '【演示】纸月亮展签',
  sourceFormat: 'sillytavern-jsonl',
  userName: '用户',
  characterName: '纸月亮策展人',
  createdAt: Date.parse('2025-01-15T12:00:00.000Z'),
  skippedCount: 2,
  messages: [
    {
      id: '1',
      role: 'user',
      speaker: '用户',
      text: '请给虚构的纸月亮展写两行展签。\n别提具体展馆。',
      createdAt: Date.parse('2025-01-15T12:00:00.000Z'),
    },
    {
      id: '2',
      role: 'assistant',
      speaker: '纸月亮策展人',
      text: '纸月亮落在窗边，\n等一阵风翻页。🌙',
      createdAt: Date.parse('2025-01-15T12:00:01.120Z'),
    },
    {
      id: '3',
      role: 'user',
      speaker: '用户',
      text: '最后再给我一个四字标题。',
      createdAt: Date.parse('2025-01-15T12:00:06.670Z'),
    },
    {
      id: '4',
      role: 'assistant',
      speaker: '纸月亮策展人',
      text: '借风翻月',
      createdAt: Date.parse('2025-01-15T12:00:07.780Z'),
    },
  ],
}

const EMPTY_DRAFT: PersonaDraft = {
  name: '',
  avatar: '✨',
  tagline: '',
  systemPrompt: '',
  greeting: '',
  memoryNotes: '',
  ttsVoice: 'stella',
  defaultThinking: false,
  defaultSearch: true,
  sourceInfo: { kind: 'manual' },
}

export const PersonaManagerModal = () => {
  const open = usePersonaStore((s) => s.managerOpen)
  const tab = usePersonaStore((s) => s.managerTab)
  const editingId = usePersonaStore((s) => s.editingPersonaId)

  if (!open) {
    return null
  }

  return (
    <Modal
      title="人格与记忆"
      closable
      className={styles.wideDialog}
      mainClassName={styles.wideDialogMain}
      onClose={closePersonaManager}
    >
      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'manage'}
          className={clsx(styles.tabBtn, tab === 'manage' && styles.tabBtnActive)}
          onClick={() => openPersonaManager('manage')}
        >
          人格库
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'quiz'}
          className={clsx(styles.tabBtn, tab === 'quiz' && styles.tabBtnActive)}
          onClick={() => openPersonaManager('quiz')}
        >
          24 题捏人
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'import'}
          className={clsx(styles.tabBtn, tab === 'import' && styles.tabBtnActive)}
          onClick={() => openPersonaManager('import')}
        >
          导入历史
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'memory'}
          className={clsx(styles.tabBtn, tab === 'memory' && styles.tabBtnActive)}
          onClick={() => openPersonaManager('memory')}
        >
          本地记忆
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'edit'}
          className={clsx(styles.tabBtn, tab === 'edit' && styles.tabBtnActive)}
          onClick={() => openPersonaManager('edit', editingId ?? undefined)}
        >
          {editingId ? '编辑' : '新建'}
        </button>
      </div>

      {tab === 'manage' ? (
        <ManageTab />
      ) : tab === 'quiz' ? (
        <PersonaQuestionnaireTab />
      ) : tab === 'import' ? (
        <ImportTab />
      ) : tab === 'memory' ? (
        <MemoryTab />
      ) : (
        <EditTab editingId={editingId} />
      )}
    </Modal>
  )
}

const ManageTab = () => {
  const personas = usePersonaStore((s) => s.personas)
  const activeId = usePersonaStore((s) => s.activePersonaId)
  const apiKey = useSettings((s) => s.apiKey)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase()
    if (!kw) {
      return personas
    }
    return personas.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.tagline.toLowerCase().includes(kw) ||
        p.systemPrompt.toLowerCase().includes(kw)
    )
  }, [personas, query])

  const previewVoice = (persona: Persona) => {
    if (!apiKey) {
      showToast('请先在「引导开启 DS」中填写 DeepSeek API Key 再试听 TTS 音色')
      closePersonaManager()
      openOnboarding()
      return
    }
    selectPersona(persona.id, true)
    const sample = persona.greeting || `你好，我是${persona.name}，很高兴认识你。`
    toggleReadAloud(`persona-preview-${persona.id}`, sample, (error) => {
      const msg = describeReadAloudError(error)
      showToast(typeof msg === 'string' ? msg : { ...msg, type: 'error' })
    })
  }

  const downloadPersona = (persona: Persona) => {
    const blob = new Blob([serializePersonaJson(persona)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${persona.name.replace(/[<>:"/\\|?*]+/g, '_') || 'persona'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  return (
    <>
      <div className={styles.toolbarRow}>
        <input
          type="search"
          className={clsx(styles.input, styles.searchInput)}
          placeholder="搜索人格名称、简介或设定..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="outlined" size="s" onClick={() => openPersonaManager('quiz')}>
          问卷 + MBTI 捏人
        </Button>
        <Button variant="outlined" size="s" onClick={() => openPersonaManager('import')}>
          导入 ZIP / JSONL
        </Button>
        <Button variant="primary" size="s" onClick={() => openPersonaManager('edit')}>
          + 手动新建
        </Button>
      </div>

      <div className={styles.personaGrid}>
        {filtered.map((persona) => {
          const isActive = persona.id === activeId
          return (
            <div
              key={persona.id}
              className={clsx(styles.personaCard, isActive && styles.personaCardActive)}
            >
              <div className={styles.personaCardHead}>
                <div className={styles.personaCardInfo}>
                  <div className={clsx(styles.avatar, styles.avatarLarge)}>{persona.avatar}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.personaTitleRow}>
                      <span className={styles.personaName}>{persona.name}</span>
                      {isActive ? <span className={styles.activeBadge}>当前生效</span> : null}
                      {persona.sourceInfo && persona.sourceInfo.kind !== 'manual' ? (
                        <span className={styles.sourceBadge}>
                          {SOURCE_LABELS[persona.sourceInfo.kind] ?? persona.sourceInfo.kind}
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.personaDesc}>
                      {persona.tagline || persona.systemPrompt.slice(0, 72) || '未填写简介'}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.cardFooter}>
                <div className={styles.cardCaps}>
                  <span className={styles.capPill}>
                    TTS：{persona.ttsVoice === 'tide' ? '暗潮（男声）' : '海星（女声）'}
                  </span>
                  <span className={clsx(styles.capPill, persona.defaultSearch && styles.capPillActive)}>
                    智能搜索：{persona.defaultSearch ? '默认开' : '默认关'}
                  </span>
                  <span
                    className={clsx(styles.capPill, persona.defaultThinking && styles.capPillActive)}
                  >
                    深度思考：{persona.defaultThinking ? '默认开' : '默认关'}
                  </span>
                </div>

                <div className={styles.cardActions}>
                  {!isActive ? (
                    <Button
                      variant="primary"
                      size="s"
                      onClick={() => {
                        selectPersona(persona.id, true)
                        showToast(`已切换人格：${persona.name}`)
                      }}
                    >
                      启用
                    </Button>
                  ) : null}
                  <Button
                    variant="outlined"
                    size="s"
                    onClick={() => {
                      selectPersona(persona.id, true)
                      openPersonaManager('memory')
                    }}
                  >
                    本地记忆
                  </Button>
                  <Button variant="outlined" size="s" onClick={() => previewVoice(persona)}>
                    试听 TTS
                  </Button>
                  <Button
                    variant="outlined"
                    size="s"
                    onClick={() => openPersonaManager('edit', persona.id)}
                  >
                    编辑
                  </Button>
                  <Button variant="outlined" size="s" onClick={() => downloadPersona(persona)}>
                    导出
                  </Button>
                  <Button
                    variant="outlined"
                    size="s"
                    onClick={() => {
                      const copy = duplicatePersona(persona.id)
                      if (copy) {
                        showToast(`已复制人格：${copy.name}`)
                      }
                    }}
                  >
                    复制
                  </Button>
                  {persona.id !== 'builtin-deepseek' ? (
                    <Button
                      variant="dangerOutlined"
                      size="s"
                      onClick={() => {
                        deletePersona(persona.id)
                        showToast(`已删除人格：${persona.name}`)
                      }}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

const ImportTab = () => {
  const apiKey = useSettings((s) => s.apiKey)
  const ragConfig = useRawRagConfig()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ImportedArchiveResult | null>(null)
  const [selectedConvId, setSelectedConvId] = useState<string>('')
  const [personaName, setPersonaName] = useState('')
  const [alsoImportChat, setAlsoImportChat] = useState(true)
  const [alsoIngestRag, setAlsoIngestRag] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedConv = useMemo(() => {
    if (!parsed || parsed.kind !== 'conversations') {
      return null
    }
    return parsed.conversations.find((c) => c.id === selectedConvId) ?? parsed.conversations[0] ?? null
  }, [parsed, selectedConvId])

  useEffect(() => {
    if (selectedConv) {
      const draft = buildPersonaDraftFromConversation(selectedConv, parsed?.fileName ?? '')
      setPersonaName(draft.name)
    }
  }, [selectedConv, parsed?.fileName])

  const handleFile = async (file: File) => {
    setError(null)
    try {
      const result = await parseImportFile(file)
      setParsed(result)
      if (result.kind === 'conversations' && result.conversations.length > 0) {
        setSelectedConvId(result.conversations[0].id)
      }
    } catch (err) {
      setParsed(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const loadBuiltInDemo = () => {
    setError(null)
    setParsed({
      kind: 'conversations',
      fileName: 'selected-chat.jsonl（内置演示样本）',
      sourceFormat: 'sillytavern-jsonl',
      conversations: [DEMO_CONVERSATION],
    })
    setSelectedConvId(DEMO_CONVERSATION.id)
  }

  const commitImportedConversation = async (useAiDistill: boolean) => {
    if (!selectedConv || !parsed || parsed.kind !== 'conversations') {
      return
    }
    if (selectedConv.messages.length === 0) {
      setError('所选会话没有可迁移正文，请切换其他会话。')
      return
    }
    if (useAiDistill && !apiKey) {
      showToast('智能提炼需要 DeepSeek API Key，正在为你打开引导向导')
      closePersonaManager()
      openOnboarding()
      return
    }

    setBusy(true)
    setError(null)
    try {
      const draft = buildPersonaDraftFromConversation(selectedConv, parsed.fileName, personaName)
      if (useAiDistill && apiKey) {
        const controller = new AbortController()
        const distilled = await distillPersonaWithDeepSeek(
          apiKey,
          selectedConv,
          draft.name,
          controller.signal
        )
        if (distilled.tagline) {
          draft.tagline = distilled.tagline
        }
        if (distilled.systemPrompt) {
          draft.systemPrompt = distilled.systemPrompt
        }
        if (distilled.memoryNotes) {
          draft.memoryNotes = distilled.memoryNotes
        }
        if (distilled.greeting) {
          draft.greeting = distilled.greeting
        }
      }

      const created = createPersona(draft, true)
      let ragCount = 0
      if (alsoIngestRag) {
        const chunks = await ingestConversationToRawRag(created.id, selectedConv, created.name)
        ragCount = chunks.length
        if (ragConfig.siliconFlowApiKey && ragCount > 0) {
          void embedPersonaMemoryChunks(created.id).catch(() => {})
        }
      }
      if (alsoImportChat) {
        const localSession = toLocalChatSession(selectedConv, created.name, created.id)
        await appendImportedSession(localSession)
      }
      showToast(
        ragCount > 0
          ? `已启用人格「${created.name}」，并写入 ${ragCount} 条本地 Raw RAG 记忆`
          : `已导入并启用人格「${created.name}」`
      )
      closePersonaManager()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const commitPersonaCards = () => {
    if (!parsed || parsed.kind !== 'personas') {
      return
    }
    let last: Persona | null = null
    for (const draft of parsed.personas) {
      last = createPersona(draft, false)
    }
    if (last) {
      selectPersona(last.id, true)
      showToast(`已导入 ${parsed.personas.length} 个人格，并启用「${last.name}」`)
      closePersonaManager()
    }
  }

  return (
    <>
      <div
        className={styles.dropzone}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) {
            void handleFile(file)
          }
        }}
      >
        <div className={styles.dropzoneTitle}>拖入或点击上传 DeepSeek 归档 / SillyTavern JSONL</div>
        <div className={styles.dropzoneHint}>
          支持 DeepSeek chat-demo v3 ZIP、DeepSeek 官网导出 ZIP / conversations.json、SillyTavern JSONL 以及人格 JSON。所有解析仅在本机浏览器完成。
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.jsonl,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) {
              void handleFile(file)
            }
          }}
        />
      </div>

      <div className={styles.toolbarRow}>
        <span className={styles.dropzoneHint}>手头暂无归档？可先载入内置虚构样本体验完整导入 + Raw RAG 记忆流程。</span>
        <Button variant="outlined" size="s" onClick={loadBuiltInDemo}>
          载入演示样本体验
        </Button>
      </div>

      {error ? <div className={clsx(styles.statusText, styles.statusErr)}>错误：{error}</div> : null}

      {parsed?.kind === 'personas' ? (
        <div className={styles.importPreviewBox}>
          <div className={styles.toolbarRow}>
            <strong>
              已识别 {parsed.personas.length} 个人格配置（{parsed.fileName}）
            </strong>
            <Button variant="primary" size="s" onClick={commitPersonaCards}>
              全部导入并启用
            </Button>
          </div>
          <div className={styles.msgPreviewList}>
            {parsed.personas.map((p, idx) => (
              <div key={idx} className={styles.msgPreviewItem}>
                <span className={styles.msgPreviewSpeaker}>
                  {p.avatar} {p.name}
                </span>
                {p.tagline || p.systemPrompt.slice(0, 80)}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {parsed?.kind === 'conversations' && selectedConv ? (
        <div className={styles.importPreviewBox}>
          <div className={styles.toolbarRow}>
            <div>
              <strong>{parsed.fileName}</strong>{' '}
              <span className={styles.sourceBadge}>
                {SOURCE_LABELS[parsed.sourceFormat] ?? parsed.sourceFormat}
              </span>
            </div>
            <span className={styles.capPill}>
              可迁移 {selectedConv.messages.length} 条 · 跳过 {selectedConv.skippedCount} 条
            </span>
          </div>

          {parsed.conversations.length > 1 ? (
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>
                选择要导入的会话（共 {parsed.conversations.length} 个）：
              </span>
              <div className={styles.sessionChips}>
                {parsed.conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    className={clsx(
                      styles.actionChip,
                      conv.id === selectedConv.id && styles.actionChipPrimary
                    )}
                    onClick={() => setSelectedConvId(conv.id)}
                  >
                    {conv.title}（{conv.messages.length}）
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.msgPreviewList}>
            {selectedConv.messages.slice(0, 12).map((msg) => (
              <div key={msg.id} className={styles.msgPreviewItem}>
                <span className={styles.msgPreviewSpeaker}>
                  {msg.role === 'user' ? selectedConv.userName : personaName || selectedConv.characterName}：
                </span>
                {msg.text}
              </div>
            ))}
            {selectedConv.messages.length > 12 ? (
              <div className={styles.dropzoneHint}>
                … 其余 {selectedConv.messages.length - 12} 条消息将在导入时一并保留
              </div>
            ) : null}
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="import-persona-name">
              导入后的人格名称
            </label>
            <input
              id="import-persona-name"
              type="text"
              className={styles.input}
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="例如：星野、纸月亮策展人"
            />
          </div>

          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={alsoIngestRag}
                onChange={(e) => setAlsoIngestRag(e.target.checked)}
              />
              <span>写入本地 Raw RAG 记忆库（聊天时自动召回原始历史）</span>
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={alsoImportChat}
                onChange={(e) => setAlsoImportChat(e.target.checked)}
              />
              <span>同时追加到左侧会话列表（不覆盖旧对话）</span>
            </label>
          </div>

          <div className={styles.toolbarRow}>
            <span className={styles.dropzoneHint}>
              离线导入零消耗；也可点击智能提炼用 DeepSeek Key 生成更贴合的性格提示词。
            </span>
            <div className={styles.cardActions}>
              <Button
                variant="outlined"
                size="m"
                disabled={busy}
                onClick={() => void commitImportedConversation(true)}
              >
                {busy ? '提炼中...' : '用 DeepSeek Key 智能提炼'}
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={busy}
                onClick={() => void commitImportedConversation(false)}
              >
                立即导入并启用人格
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

const MemoryTab = () => {
  const activePersonaId = usePersonaStore((s) => s.activePersonaId)
  const persona = useMemo(() => getActivePersona(), [activePersonaId])
  const apiKey = useSettings((s) => s.apiKey)
  const rag = useRawRagConfig()

  const [chunks, setChunks] = useState<MemoryChunk[]>([])
  const [query, setQuery] = useState('')
  const [recalled, setRecalled] = useState<RetrievedMemory[] | null>(null)
  const [manualText, setManualText] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = useCallback(async () => {
    const items = await listMemoryChunks(persona.id)
    setChunks(items)
  }, [persona.id])

  useEffect(() => {
    void refresh()
    setRecalled(null)
  }, [refresh])

  const embeddedCount = useMemo(
    () => chunks.filter((c) => c.embedding && c.embeddingModel === rag.embeddingModel).length,
    [chunks, rag.embeddingModel]
  )

  const handleTestRetrieve = async () => {
    if (!query.trim()) {
      return
    }
    setBusy(true)
    try {
      const hits = await retrieveRawMemory(persona.id, query)
      setRecalled(hits)
    } finally {
      setBusy(false)
    }
  }

  const handleIndexAll = async () => {
    if (!rag.siliconFlowApiKey) {
      showToast('请先在引导向导第 2 步配置硅基流动 API Key（充值 1 元即可用免费向量模型）')
      closePersonaManager()
      openOnboarding()
      return
    }
    setBusy(true)
    setStatusMsg(null)
    try {
      const res = await embedPersonaMemoryChunks(persona.id, (done, total) => {
        setStatusMsg({ ok: true, text: `正在用 ${rag.embeddingModel} 向量化：${done} / ${total}...` })
      })
      await refresh()
      setStatusMsg({
        ok: true,
        text:
          res.embedded > 0
            ? `向量索引完成！本次新增 ${res.embedded} 条，共 ${res.total} 条已就绪。`
            : `全部 ${res.total} 条记忆均已完成 ${rag.embeddingModel} 向量索引。`,
      })
    } catch (err) {
      setStatusMsg({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const handleAgentAutoConfig = async () => {
    if (!apiKey) {
      showToast('请先配置 DeepSeek API Key 以启用 Agent 自动配置')
      closePersonaManager()
      openOnboarding()
      return
    }
    setBusy(true)
    setStatusMsg(null)
    try {
      const controller = new AbortController()
      const { applied, reason } = await configureRawRagWithDeepSeekAgent(
        apiKey,
        persona.id,
        controller.signal
      )
      setStatusMsg({
        ok: true,
        text: `Agent 自动配置完成（Top-K=${applied.topK}，阈值=${applied.minScore}，单块=${applied.maxChunkChars}字）：${reason}`,
      })
    } catch (err) {
      setStatusMsg({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const handleAddManual = async () => {
    if (!manualText.trim()) {
      return
    }
    setBusy(true)
    try {
      await addManualMemoryChunk(persona.id, manualText)
      setManualText('')
      await refresh()
      showToast('已存入本地 Raw RAG 记忆库')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles.importPreviewBox}>
        <div className={styles.toolbarRow}>
          <div>
            <strong>
              {persona.avatar} {persona.name} 的本地 Raw RAG 记忆库
            </strong>
            <div className={styles.dropzoneHint}>
              当前共 <strong>{chunks.length}</strong> 条原始记忆块 · 已向量化{' '}
              <strong>{embeddedCount}</strong> 条 · 检索模式：
              {rag.siliconFlowApiKey
                ? `硅基流动免费向量（${rag.embeddingModel}）+ BM25`
                : '纯本地零配置 BM25（填硅基流动 Key 可升级语义向量）'}
            </div>
          </div>
          <div className={styles.cardActions}>
            <Button variant="outlined" size="s" disabled={busy} onClick={() => void handleAgentAutoConfig()}>
              🤖 DS Key 自动配置
            </Button>
            <Button variant="primary" size="s" disabled={busy} onClick={() => void handleIndexAll()}>
              ⚡ 硅基流动向量化
            </Button>
          </div>
        </div>

        <div className={styles.checkboxRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={rag.enabled}
              onChange={(e) => updateRawRagConfig({ enabled: e.target.checked })}
            />
            <span>发消息时自动召回本地 Raw RAG（Top-{rag.topK}）</span>
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={rag.autoIngest}
              onChange={(e) => updateRawRagConfig({ autoIngest: e.target.checked })}
            />
            <span>新对话完成后自动沉淀原始轮次到记忆库</span>
          </label>
          <Button
            variant="outlined"
            size="s"
            onClick={() => {
              closePersonaManager()
              openOnboarding()
            }}
          >
            配置硅基流动 1 元免费向量 Key
          </Button>
        </div>

        <div className={styles.toolbarRow}>
          <div className={styles.fieldGroup} style={{ flex: 1, minWidth: 220 }}>
            <label className={styles.fieldLabel}>当前向量模型</label>
            <Select
              ariaLabel="当前向量模型"
              value={rag.embeddingModel}
              options={SILICONFLOW_FREE_EMBEDDING_MODELS.map((m) => ({
                value: m.id,
                label: m.label,
              }))}
              onChange={(model) => updateRawRagConfig({ embeddingModel: model })}
            />
          </div>
          <span className={styles.dropzoneHint}>
            {rag.lastAgentNote ? `Agent 配置说明：${rag.lastAgentNote}` : '零配置默认参数即可直接使用。'}
          </span>
        </div>

        {statusMsg ? (
          <div className={clsx(styles.statusText, statusMsg.ok ? styles.statusOk : styles.statusErr)}>
            {statusMsg.text}
          </div>
        ) : null}
      </div>

      <div className={styles.toolbarRow}>
        <input
          type="text"
          className={clsx(styles.input, styles.searchInput)}
          placeholder="输入一句话测试 Raw RAG 召回效果（例如：纸月亮、四字标题）..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleTestRetrieve()
            }
          }}
        />
        <Button variant="primary" size="s" disabled={busy} onClick={() => void handleTestRetrieve()}>
          测试召回
        </Button>
      </div>

      {recalled !== null ? (
        <div className={styles.importPreviewBox}>
          <strong style={{ fontSize: 13 }}>召回测试结果（命中 {recalled.length} 条）：</strong>
          {recalled.length === 0 ? (
            <div className={styles.dropzoneHint}>未命中达到阈值的相关记忆块。</div>
          ) : (
            recalled.map((hit, idx) => (
              <div key={hit.chunk.id} className={styles.memoryChunkCard}>
                <div className={styles.memoryChunkHead}>
                  <span>
                    #{idx + 1} 来源：{hit.chunk.sourceTitle} ·{' '}
                    {hit.mode === 'hybrid-vector' ? '向量+BM25' : '本地BM25'}
                  </span>
                  <strong>相关度 {(hit.score * 100).toFixed(0)}%</strong>
                </div>
                <div className={styles.memoryChunkBody}>{hit.chunk.text}</div>
              </div>
            ))
          )}
        </div>
      ) : null}

      <div className={styles.toolbarRow}>
        <input
          type="text"
          className={clsx(styles.input, styles.searchInput)}
          placeholder="手动补充一条原始记忆（如：用户喜欢靠窗座位，偏好简短回复）..."
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
        />
        <Button variant="outlined" size="s" disabled={busy} onClick={() => void handleAddManual()}>
          + 存入记忆
        </Button>
        {chunks.length > 0 ? (
          <Button
            variant="dangerOutlined"
            size="s"
            disabled={busy}
            onClick={async () => {
              await clearPersonaMemory(persona.id)
              await refresh()
              setRecalled(null)
              showToast('已清空当前人格的本地记忆库')
            }}
          >
            清空全部
          </Button>
        ) : null}
      </div>

      <div className={styles.msgPreviewList}>
        {chunks.length === 0 ? (
          <div className={styles.dropzoneHint}>
            暂无本地原始记忆。去「导入人格」载入 ZIP / JSONL 或直接开始聊天，记忆会自动沉淀在这里。
          </div>
        ) : (
          chunks.slice(0, 30).map((chunk) => (
            <div key={chunk.id} className={styles.memoryChunkCard}>
              <div className={styles.memoryChunkHead}>
                <span>
                  来源：{chunk.sourceTitle} ·{' '}
                  {chunk.embedding && chunk.embeddingModel === rag.embeddingModel
                    ? '已向量化'
                    : 'BM25 原始块'}
                </span>
                <button
                  type="button"
                  className={styles.siderMiniBtn}
                  onClick={async () => {
                    await deleteMemoryChunk(chunk.id)
                    await refresh()
                  }}
                >
                  删除
                </button>
              </div>
              <div className={styles.memoryChunkBody}>{chunk.text}</div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

const EditTab = ({ editingId }: { editingId: string | null }) => {
  const personas = usePersonaStore((s) => s.personas)
  const existing = useMemo(
    () => (editingId ? personas.find((p) => p.id === editingId) ?? null : null),
    [editingId, personas]
  )

  const [draft, setDraft] = useState<PersonaDraft>(() =>
    existing
      ? {
          name: existing.name,
          avatar: existing.avatar,
          tagline: existing.tagline,
          systemPrompt: existing.systemPrompt,
          greeting: existing.greeting,
          memoryNotes: existing.memoryNotes,
          ttsVoice: existing.ttsVoice,
          defaultThinking: existing.defaultThinking,
          defaultSearch: existing.defaultSearch,
          sourceInfo: existing.sourceInfo,
        }
      : EMPTY_DRAFT
  )

  useEffect(() => {
    if (existing) {
      setDraft({
        name: existing.name,
        avatar: existing.avatar,
        tagline: existing.tagline,
        systemPrompt: existing.systemPrompt,
        greeting: existing.greeting,
        memoryNotes: existing.memoryNotes,
        ttsVoice: existing.ttsVoice,
        defaultThinking: existing.defaultThinking,
        defaultSearch: existing.defaultSearch,
        sourceInfo: existing.sourceInfo,
      })
    } else {
      setDraft(EMPTY_DRAFT)
    }
  }, [existing])

  const onSubmit = () => {
    if (!draft.name.trim()) {
      showToast('请填写人格名称')
      return
    }
    const cleaned: PersonaDraft = {
      ...draft,
      name: draft.name.trim(),
      avatar: draft.avatar.trim() || draft.name.trim().slice(0, 1) || '✨',
      tagline: draft.tagline.trim(),
      systemPrompt: draft.systemPrompt.trim(),
      greeting: draft.greeting.trim(),
      memoryNotes: draft.memoryNotes.trim(),
    }
    if (existing) {
      updatePersona(existing.id, cleaned)
      showToast(`已保存人格「${cleaned.name}」`)
    } else {
      createPersona(cleaned, true)
      showToast(`已创建并启用人格「${cleaned.name}」`)
    }
    openPersonaManager('manage')
  }

  return (
    <>
      <div className={styles.formGrid}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>人格名称</label>
          <input
            type="text"
            className={styles.input}
            placeholder="例如：星野、私人学习导师"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>头像字符 / Emoji</label>
          <input
            type="text"
            className={styles.input}
            maxLength={4}
            placeholder="🌙"
            value={draft.avatar}
            onChange={(e) => setDraft({ ...draft, avatar: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>一句话简介</label>
        <input
          type="text"
          className={styles.input}
          placeholder="例如：温和自然的日常聊天与语音朗读伙伴"
          value={draft.tagline}
          onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
        />
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>人格设定（System Prompt）</label>
        <textarea
          className={styles.textarea}
          placeholder="描述角色性格、称呼方式、表达习惯与回答边界..."
          value={draft.systemPrompt}
          onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
        />
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>欢迎开场白（显示在新对话页）</label>
        <input
          type="text"
          className={styles.input}
          placeholder="例如：今天想聊点什么？"
          value={draft.greeting}
          onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
        />
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>固定记忆摘录（另可在「本地记忆 Raw RAG」按需检索更多历史）</label>
        <textarea
          className={styles.textarea}
          placeholder="可留空，或填写希望角色始终记住的核心设定与偏好..."
          value={draft.memoryNotes}
          onChange={(e) => setDraft({ ...draft, memoryNotes: e.target.value })}
        />
      </div>

      <div className={styles.toolbarRow}>
        <div className={styles.fieldGroup} style={{ minWidth: 180 }}>
          <label className={styles.fieldLabel}>默认 DeepSeek TTS 音色</label>
          <Select
            ariaLabel="默认 DeepSeek TTS 音色"
            value={draft.ttsVoice}
            options={[
              { value: 'stella', label: '海星（女声 · stella）' },
              { value: 'tide', label: '暗潮（男声 · tide）' },
            ]}
            onChange={(value) => setDraft({ ...draft, ttsVoice: value as TtsVoice })}
          />
        </div>
        <div className={styles.checkboxRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={draft.defaultSearch}
              onChange={(e) => setDraft({ ...draft, defaultSearch: e.target.checked })}
            />
            <span>默认开启智能搜索（Web Search）</span>
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={draft.defaultThinking}
              onChange={(e) => setDraft({ ...draft, defaultThinking: e.target.checked })}
            />
            <span>默认开启深度思考</span>
          </label>
        </div>
      </div>

      <div className={styles.toolbarRow}>
        <Button variant="outlined" size="m" onClick={() => openPersonaManager('manage')}>
          返回列表
        </Button>
        <Button variant="primary" size="m" onClick={onSubmit}>
          {existing ? '保存修改' : '创建并启用'}
        </Button>
      </div>
    </>
  )
}
