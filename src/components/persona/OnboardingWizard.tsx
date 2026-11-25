import clsx from 'clsx'
import { useRef, useState } from 'react'
import { verifyApiKey } from '../../services/api/client.js'
import type { TtsVoice } from '../../services/api/speech.js'
import {
  activateEmbeddingProfile,
  addEmbeddingProfile,
  configureRawRagWithDeepSeekAgent,
  deleteEmbeddingProfile,
  EMBEDDING_TEMPLATES,
  fetchEmbeddingModelsFromEndpoint,
  testSiliconFlowEmbedding,
  updateEmbeddingProfile,
  updateRawRagConfig,
  useRawRagConfig,
} from '../../services/memory/rawRag.js'
import {
  closeOnboarding,
  openPersonaManager,
  selectPersona,
  usePersonaStore,
} from '../../services/persona/store.js'
import {
  activateCustomLlmProfile,
  addCustomLlmProfile,
  BUILTIN_OFM_BASE_URL,
  CUSTOM_LLM_TEMPLATES,
  deleteCustomLlmProfile,
  fetchModelsFromEndpoint,
  fetchOurFreeModels,
  OURFREE_PRESET_ENDPOINTS,
  updateCustomLlmProfile,
  updateProviderConfig,
  useProviderStore,
  type CustomLlmProtocol,
} from '../../services/providers/ourFreeModel.js'
import {
  setApiKey,
  setSearch,
  setThinking,
  setTtsVoice,
  useSettings,
} from '../../services/settings.js'
import {
  activateTtsProfile,
  addCustomTtsProfile,
  CUSTOM_TTS_TEMPLATES,
  deleteClonedVoice,
  deleteCustomTtsProfile,
  fetchTtsModelsFromEndpoint,
  loadClonedVoiceDataUrl,
  registerSiliconFlowClonedVoice,
  saveClonedVoice,
  selectClonedVoice,
  setTtsEngineMode,
  updateCustomTtsProfile,
  useCustomTtsStore,
  type ClonedVoiceMeta,
  type CustomTtsAdapter,
} from '../../services/speech/customTts.js'
import { describeReadAloudError, toggleReadAloud } from '../../services/speech/readAloud.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Persona.module.css'

/**
 * 统一模型与能力配置向导（CC-Switch 多配置档一键切换 + 一键拉取模型名）：
 * Tab 1：对话模型 · LLM（内置免费池 / DeepSeek 官方 / CC-Switch 自定义 LLM）
 * Tab 2：向量记忆 · Embedding（本地 Raw RAG + CC-Switch 自定义向量源 + 硅基流动 1 元教程）
 * Tab 3：语音 TTS · 声音克隆（自动 / DeepSeek 原生 / CC-Switch 自定义 TTS & 声音克隆工作台）
 * Tab 4：人格与开聊
 */
export const OnboardingWizard = () => {
  const open = usePersonaStore((s) => s.onboardingOpen)
  const personas = usePersonaStore((s) => s.personas)
  const activePersonaId = usePersonaStore((s) => s.activePersonaId)

  const apiKey = useSettings((s) => s.apiKey)
  const search = useSettings((s) => s.search)
  const thinking = useSettings((s) => s.thinking)
  const ttsVoice = useSettings((s) => s.ttsVoice)

  const provider = useProviderStore()
  const rag = useRawRagConfig()
  const tts = useCustomTtsStore()

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1: DeepSeek / OurFreeModel / Custom LLM
  const [keyInput, setKeyInput] = useState(apiKey ?? '')
  const [verifyingDs, setVerifyingDs] = useState(false)
  const [dsMsg, setDsMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [fetchingFree, setFetchingFree] = useState(false)
  const [freeMsg, setFreeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [fetchingCustomLlm, setFetchingCustomLlm] = useState(false)
  const [customLlmMsg, setCustomLlmMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Step 2: Embedding CC-Switch + Raw RAG Agent
  const [fetchingEmbed, setFetchingEmbed] = useState(false)
  const [testingEmbed, setTestingEmbed] = useState(false)
  const [embedMsg, setEmbedMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentMsg, setAgentMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Step 3: Custom TTS & Voice Cloning
  const [fetchingTts, setFetchingTts] = useState(false)
  const [ttsMsg, setTtsMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cloneFile, setCloneFile] = useState<File | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloneRefText, setCloneRefText] = useState('')
  const [savingClone, setSavingClone] = useState(false)
  const [registeringVoiceId, setRegisteringVoiceId] = useState<string | null>(null)
  const cloneFileInputRef = useRef<HTMLInputElement>(null)
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null)

  if (!open) {
    return null
  }

  const activeCustomLlm =
    provider.customProfiles.find((p) => p.id === provider.activeCustomProfileId) ??
    provider.customProfiles[0] ??
    null

  const activeEmbed =
    rag.embeddingProfiles.find((p) => p.id === rag.activeEmbeddingProfileId) ??
    rag.embeddingProfiles[0]

  const activeTts =
    tts.profiles.find((p) => p.id === tts.activeProfileId) ?? tts.profiles[0]

  const buildModelOptions = (models: string[], current: string) => {
    const merged = current.trim() && !models.includes(current.trim())
      ? [current.trim(), ...models]
      : models
    const finalList = merged.length > 0 ? merged : ['(点击右侧一键拉取或手填)']
    return finalList.map((m) => ({ value: m, label: m }))
  }

  // ---------- Step 1 Handlers ----------
  const handleVerifyDsKey = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed) {
      setDsMsg({ ok: false, text: '请先粘贴 DeepSeek API Key（以 sk- 开头）。' })
      return
    }
    setVerifyingDs(true)
    setDsMsg(null)
    try {
      await verifyApiKey(trimmed)
      setApiKey(trimmed)
      updateProviderConfig({ chatProvider: 'deepseek' })
      setDsMsg({
        ok: true,
        text: '验证通过并已保存到本地，已解锁深度思考、智能搜索与官方 TTS 朗读。',
      })
    } catch (err) {
      setDsMsg({
        ok: false,
        text: `验证失败：${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setVerifyingDs(false)
    }
  }

  const handleFetchOurFree = async () => {
    setFetchingFree(true)
    setFreeMsg(null)
    try {
      const models = await fetchOurFreeModels(provider.ourFreeBaseUrl, provider.ourFreeApiKey)
      const preferred =
        models.find((m) => m.toLowerCase().includes('deepseek')) ?? models[0]
      updateProviderConfig({
        chatProvider: 'ourfree',
        ourFreeModels: models,
        ourFreeModel: models.includes(provider.ourFreeModel) ? provider.ourFreeModel : preferred,
      })
      setFreeMsg({
        ok: true,
        text: `已同步 ${models.length} 个可用免费模型，当前选用 ${preferred}。`,
      })
    } catch (err) {
      setFreeMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setFetchingFree(false)
    }
  }

  const handleFetchCustomLlmModels = async () => {
    if (!activeCustomLlm) {
      return
    }
    setFetchingCustomLlm(true)
    setCustomLlmMsg(null)
    try {
      const models = await fetchModelsFromEndpoint(
        activeCustomLlm.baseUrl,
        activeCustomLlm.apiKey,
        activeCustomLlm.protocol
      )
      const nextModel =
        activeCustomLlm.model.trim() && models.includes(activeCustomLlm.model.trim())
          ? activeCustomLlm.model.trim()
          : models[0]
      updateCustomLlmProfile(activeCustomLlm.id, {
        fetchedModels: models,
        model: nextModel,
      })
      setCustomLlmMsg({
        ok: true,
        text: `一键拉取成功！共获取 ${models.length} 个模型，当前已选中 ${nextModel}。`,
      })
    } catch (err) {
      setCustomLlmMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setFetchingCustomLlm(false)
    }
  }

  // ---------- Step 2 Handlers ----------
  const handleFetchEmbeddingModels = async () => {
    setFetchingEmbed(true)
    setEmbedMsg(null)
    try {
      const models = await fetchEmbeddingModelsFromEndpoint(
        activeEmbed.baseUrl,
        activeEmbed.apiKey
      )
      const nextModel =
        activeEmbed.model.trim() && models.includes(activeEmbed.model.trim())
          ? activeEmbed.model.trim()
          : models[0]
      updateEmbeddingProfile(activeEmbed.id, {
        fetchedModels: models,
        model: nextModel,
      })
      setEmbedMsg({
        ok: true,
        text: `一键拉取成功！共获取 ${models.length} 个模型（向量模型已置顶），当前选中 ${nextModel}。`,
      })
    } catch (err) {
      setEmbedMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setFetchingEmbed(false)
    }
  }

  const handleTestEmbedding = async () => {
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(
      activeEmbed.baseUrl.trim()
    )
    if (!isLocal && !activeEmbed.apiKey.trim()) {
      setEmbedMsg({
        ok: false,
        text: '云端向量接口需填写 API Key（若使用本机 Ollama 则无需 Key）。',
      })
      return
    }
    setTestingEmbed(true)
    setEmbedMsg(null)
    try {
      const { dimensions } = await testSiliconFlowEmbedding(
        activeEmbed.apiKey.trim(),
        activeEmbed.baseUrl.trim(),
        activeEmbed.model.trim()
      )
      updateRawRagConfig({ enabled: true })
      setEmbedMsg({
        ok: true,
        text: `连通成功！向量模型 ${activeEmbed.model} 输出 ${dimensions} 维，本地记忆已启用向量 + BM25 混合召回。`,
      })
    } catch (err) {
      setEmbedMsg({
        ok: false,
        text: `测试失败：${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setTestingEmbed(false)
    }
  }

  const handleAgentConfigureRag = async () => {
    const activeKey = apiKey || keyInput.trim()
    if (!activeKey) {
      setAgentMsg({
        ok: false,
        text: '需在第 1 步填写 DeepSeek API Key，才能让 DeepSeek 自动配置本地 RAG 参数。',
      })
      return
    }
    if (!apiKey && keyInput.trim()) {
      setApiKey(keyInput.trim())
    }
    setAgentBusy(true)
    setAgentMsg(null)
    try {
      const controller = new AbortController()
      const { applied, reason } = await configureRawRagWithDeepSeekAgent(
        activeKey,
        activePersonaId,
        controller.signal
      )
      setAgentMsg({
        ok: true,
        text: `自动配置完成（Top-K=${applied.topK}，阈值=${applied.minScore}，单块=${applied.maxChunkChars}字）：${reason}`,
      })
    } catch (err) {
      setAgentMsg({
        ok: false,
        text: `自动配置失败：${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setAgentBusy(false)
    }
  }

  // ---------- Step 3 Handlers ----------
  const handleFetchTtsModels = async () => {
    setFetchingTts(true)
    setTtsMsg(null)
    try {
      const models = await fetchTtsModelsFromEndpoint(activeTts.baseUrl, activeTts.apiKey)
      const nextModel =
        activeTts.model.trim() && models.includes(activeTts.model.trim())
          ? activeTts.model.trim()
          : models[0]
      updateCustomTtsProfile(activeTts.id, {
        fetchedModels: models,
        model: nextModel,
      })
      setTtsMsg({
        ok: true,
        text: `一键拉取成功！共获取 ${models.length} 个模型（语音模型已置顶），当前选中 ${nextModel}。`,
      })
    } catch (err) {
      setTtsMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setFetchingTts(false)
    }
  }

  const handleSaveClonedVoice = async () => {
    if (!cloneFile) {
      setTtsMsg({ ok: false, text: '请先选择一段 3–15 秒的清晰参考音频（WAV / MP3 / M4A）。' })
      return
    }
    setSavingClone(true)
    setTtsMsg(null)
    try {
      const meta = await saveClonedVoice(cloneFile, cloneName, cloneRefText)
      setCloneFile(null)
      setCloneName('')
      setCloneRefText('')
      if (cloneFileInputRef.current) {
        cloneFileInputRef.current.value = ''
      }
      setTtsMsg({
        ok: true,
        text: `已保存克隆音色「${meta.name}」并设为当前启用，可直接试听或在硅基流动注册云端 URI。`,
      })
    } catch (err) {
      setTtsMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSavingClone(false)
    }
  }

  const handlePlaySampleVoice = async (voice: ClonedVoiceMeta) => {
    try {
      sampleAudioRef.current?.pause()
      const dataUrl = await loadClonedVoiceDataUrl(voice.id)
      if (!dataUrl) {
        showToast('本地未找到参考音频文件')
        return
      }
      const audio = new Audio(dataUrl)
      sampleAudioRef.current = audio
      await audio.play()
    } catch (err) {
      showToast(`试听原声失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRegisterSiliconFlowVoice = async (voice: ClonedVoiceMeta) => {
    setRegisteringVoiceId(voice.id)
    setTtsMsg(null)
    try {
      const uri = await registerSiliconFlowClonedVoice(activeTts, voice)
      selectClonedVoice(voice.id)
      setTtsMsg({
        ok: true,
        text: `声音克隆注册成功！已绑定云端音色 URI：${uri}`,
      })
    } catch (err) {
      setTtsMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setRegisteringVoiceId(null)
    }
  }

  const handleTestTts = () => {
    if (tts.engineMode === 'deepseek') {
      const activeKey = apiKey || keyInput.trim()
      if (!activeKey) {
        showToast('DeepSeek 官方 TTS 需在第 1 步填写 DeepSeek API Key')
        setStep(1)
        return
      }
      if (!apiKey && keyInput.trim()) {
        setApiKey(keyInput.trim())
      }
    }
    toggleReadAloud(
      'onboarding-tts-sample',
      '你好，欢迎使用 DeepSeek Persona。现在你可以通过自定义语音或声音克隆，随时收听我的回复。',
      (error) => {
        const msg = describeReadAloudError(error)
        showToast(typeof msg === 'string' ? msg : { ...msg, type: 'error' })
      },
      (info) => showToast(info)
    )
  }

  const finishAndStart = () => {
    if (!apiKey && keyInput.trim()) {
      setApiKey(keyInput.trim())
    }
    closeOnboarding(true)
    if (provider.chatProvider === 'custom' && activeCustomLlm) {
      showToast(`已切换至自定义模型：${activeCustomLlm.name}（${activeCustomLlm.model}）`)
    } else if (provider.chatProvider === 'ourfree') {
      showToast(`已就绪！当前使用内置免费池（${provider.ourFreeModel}）`)
    } else {
      showToast('已就绪！开始和你的 DeepSeek 人格对话吧')
    }
  }

  return (
    <Modal
      title="模型源 · 向量记忆 · 语音克隆"
      closable
      className={styles.wideDialog}
      mainClassName={styles.wideDialogMain}
      onClose={() => closeOnboarding(true)}
      footer={
        <div className={styles.footerBar}>
          <Button variant="outlined" size="m" onClick={() => closeOnboarding(true)}>
            关闭
          </Button>
          <div className={styles.footerRight}>
            {step > 1 ? (
              <Button
                variant="outlined"
                size="m"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : 1))}
              >
                上一步
              </Button>
            ) : null}
            {step < 4 ? (
              <Button
                variant="primary"
                size="m"
                onClick={() => setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : 4))}
              >
                下一步
              </Button>
            ) : (
              <Button variant="primary" size="m" onClick={finishAndStart}>
                完成并开始对话
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className={styles.stepper}>
        <button
          type="button"
          className={clsx(styles.stepItem, step === 1 && styles.stepItemActive)}
          onClick={() => setStep(1)}
        >
          <div className={styles.stepNum}>01</div>
          <div className={styles.stepTitle}>对话模型 · LLM</div>
        </button>
        <button
          type="button"
          className={clsx(styles.stepItem, step === 2 && styles.stepItemActive)}
          onClick={() => setStep(2)}
        >
          <div className={styles.stepNum}>02</div>
          <div className={styles.stepTitle}>向量记忆 · RAG</div>
        </button>
        <button
          type="button"
          className={clsx(styles.stepItem, step === 3 && styles.stepItemActive)}
          onClick={() => setStep(3)}
        >
          <div className={styles.stepNum}>03</div>
          <div className={styles.stepTitle}>语音 TTS · 克隆</div>
        </button>
        <button
          type="button"
          className={clsx(styles.stepItem, step === 4 && styles.stepItemActive)}
          onClick={() => setStep(4)}
        >
          <div className={styles.stepNum}>04</div>
          <div className={styles.stepTitle}>人格与开聊</div>
        </button>
      </div>

      {/* ==================== TAB 1: LLM ==================== */}
      {step === 1 ? (
        <div className={styles.wizardCard}>
          <div className={styles.providerSwitch3}>
            <button
              type="button"
              className={clsx(
                styles.providerCard,
                provider.chatProvider === 'ourfree' && styles.providerCardActive
              )}
              onClick={() => updateProviderConfig({ chatProvider: 'ourfree' })}
            >
              <div className={styles.personaTitleRow}>
                <span className={styles.personaName}>内置免费池</span>
                {provider.chatProvider === 'ourfree' ? (
                  <span className={styles.activeBadge}>当前</span>
                ) : null}
              </div>
              <span className={styles.capCardDesc}>
                已预装 OurFreeModel，零配置直接聊
              </span>
            </button>

            <button
              type="button"
              className={clsx(
                styles.providerCard,
                provider.chatProvider === 'deepseek' && styles.providerCardActive
              )}
              onClick={() => updateProviderConfig({ chatProvider: 'deepseek' })}
            >
              <div className={styles.personaTitleRow}>
                <span className={styles.personaName}>DeepSeek 官方</span>
                {provider.chatProvider === 'deepseek' ? (
                  <span className={styles.activeBadge}>当前</span>
                ) : null}
              </div>
              <span className={styles.capCardDesc}>
                原生深度思考、联网搜索与官方 TTS
              </span>
            </button>

            <button
              type="button"
              className={clsx(
                styles.providerCard,
                provider.chatProvider === 'custom' && styles.providerCardActive
              )}
              onClick={() => updateProviderConfig({ chatProvider: 'custom' })}
            >
              <div className={styles.personaTitleRow}>
                <span className={styles.personaName}>自定义 LLM</span>
                {provider.chatProvider === 'custom' ? (
                  <span className={styles.activeBadge}>当前</span>
                ) : null}
              </div>
              <span className={styles.capCardDesc}>
                CC-Switch 多配置档一键切 & 拉取模型
              </span>
            </button>
          </div>

          {provider.chatProvider === 'deepseek' ? (
            <>
              <details className={styles.compactDetails} open={!apiKey}>
                <summary>4 步获取 DeepSeek API Key 教程</summary>
                <ol className={styles.tutorialSteps} style={{ marginTop: 8 }}>
                  <li>
                    打开{' '}
                    <a
                      className={styles.helperLink}
                      href="https://platform.deepseek.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      platform.deepseek.com
                    </a>{' '}
                    登录并充值（按量计费，首次充 10 元可用很久）。
                  </li>
                  <li>
                    前往{' '}
                    <a
                      className={styles.helperLink}
                      href="https://platform.deepseek.com/api_keys"
                      target="_blank"
                      rel="noreferrer"
                    >
                      API Keys 页面
                    </a>{' '}
                    创建并复制 <span className={styles.codeInline}>sk-...</span>。
                  </li>
                  <li>
                    粘贴到下方验证（仅请求免费 <span className={styles.codeInline}>GET /models</span>，Key 仅保存在本机浏览器）。
                  </li>
                </ol>
              </details>

              <div className={styles.toolbarRow}>
                <input
                  type="password"
                  className={clsx(styles.input, styles.searchInput)}
                  placeholder="粘贴 DeepSeek API Key（sk-...）"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                />
                <Button
                  variant="primary"
                  size="m"
                  disabled={verifyingDs}
                  onClick={() => void handleVerifyDsKey()}
                >
                  {verifyingDs ? '验证中...' : '验证并保存'}
                </Button>
              </div>

              {dsMsg ? (
                <div className={clsx(styles.statusText, dsMsg.ok ? styles.statusOk : styles.statusErr)}>
                  {dsMsg.text}
                </div>
              ) : apiKey ? (
                <div className={clsx(styles.statusText, styles.statusOk)}>
                  已保存 DeepSeek API Key。
                </div>
              ) : null}
            </>
          ) : provider.chatProvider === 'ourfree' ? (
            <>
              <div className={styles.ccEditorCard}>
                <div className={styles.toolbarRow}>
                  <span className={styles.fieldLabel}>
                    内置 DSH OurFreeModel：
                    {provider.builtInOfm.running
                      ? `运行中（v${provider.builtInOfm.version} · 已预装）`
                      : provider.builtInOfm.checked
                        ? '未检测到内置服务'
                        : '初始化中...'}
                  </span>
                  {provider.builtInOfm.running && provider.builtInOfm.managementUrl ? (
                    <a
                      className={styles.helperLink}
                      href={provider.builtInOfm.managementUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      管理控制台 ↗
                    </a>
                  ) : null}
                </div>

                <div className={styles.toolbarRow}>
                  <div className={styles.fieldGroup} style={{ flex: 1, minWidth: 220 }}>
                    <label className={styles.fieldLabel}>
                      当前免费模型（已加载 {provider.ourFreeModels.length} 个）
                    </label>
                    <Select
                      ariaLabel="选择内置免费模型"
                      value={provider.ourFreeModel}
                      options={buildModelOptions(provider.ourFreeModels, provider.ourFreeModel)}
                      onChange={(model) => updateProviderConfig({ ourFreeModel: model })}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>上游列表</label>
                    <Button
                      variant="primary"
                      size="m"
                      disabled={fetchingFree}
                      onClick={() => void handleFetchOurFree()}
                    >
                      {fetchingFree ? '拉取中...' : '一键拉取模型'}
                    </Button>
                  </div>
                </div>

                <div className={styles.sessionChips}>
                  {OURFREE_PRESET_ENDPOINTS.map((preset) => (
                    <button
                      key={preset.baseUrl}
                      type="button"
                      className={clsx(
                        styles.actionChip,
                        provider.ourFreeBaseUrl === preset.baseUrl && styles.actionChipPrimary
                      )}
                      onClick={() => updateProviderConfig({ ourFreeBaseUrl: preset.baseUrl })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {provider.ourFreeBaseUrl !== BUILTIN_OFM_BASE_URL ? (
                  <div className={styles.ccFieldGrid2}>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="自定义 Base URL"
                      value={provider.ourFreeBaseUrl}
                      onChange={(e) => updateProviderConfig({ ourFreeBaseUrl: e.target.value })}
                    />
                    <input
                      type="password"
                      className={styles.input}
                      placeholder="可选 API Key"
                      value={provider.ourFreeApiKey}
                      onChange={(e) => updateProviderConfig({ ourFreeApiKey: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>

              {freeMsg ? (
                <div className={clsx(styles.statusText, freeMsg.ok ? styles.statusOk : styles.statusErr)}>
                  {freeMsg.text}
                </div>
              ) : null}
            </>
          ) : (
            /* ---------- CC-Switch Custom LLM ---------- */
            <>
              <div className={styles.fieldGroup}>
                <div className={styles.toolbarRow}>
                  <label className={styles.fieldLabel}>
                    LLM 配置档（CC-Switch · 点击一键切换）
                  </label>
                  <div className={styles.sessionChips}>
                    {CUSTOM_LLM_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.name}
                        type="button"
                        className={styles.actionChip}
                        onClick={() => {
                          addCustomLlmProfile({
                            name: tpl.name,
                            protocol: tpl.protocol,
                            baseUrl: tpl.baseUrl,
                            apiKey: '',
                            model: tpl.model,
                          })
                          setCustomLlmMsg(null)
                        }}
                      >
                        + {tpl.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.ccProfileStrip}>
                  {provider.customProfiles.map((p) => {
                    const active = p.id === activeCustomLlm?.id
                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        className={clsx(
                          styles.ccProfileChip,
                          active && styles.ccProfileChipActive
                        )}
                        onClick={() => {
                          activateCustomLlmProfile(p.id)
                          setCustomLlmMsg(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            activateCustomLlmProfile(p.id)
                          }
                        }}
                      >
                        <span className={clsx(styles.statusDot, active && styles.statusDotOk)} />
                        <span>{p.name}</span>
                        {provider.customProfiles.length > 1 ? (
                          <button
                            type="button"
                            className={styles.ccProfileDel}
                            aria-label={`删除 ${p.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteCustomLlmProfile(p.id)
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>

              {activeCustomLlm ? (
                <div className={styles.ccEditorCard}>
                  <div className={styles.ccFieldGrid2}>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>配置档名称</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={activeCustomLlm.name}
                        onChange={(e) =>
                          updateCustomLlmProfile(activeCustomLlm.id, { name: e.target.value })
                        }
                        placeholder="如：硅基流动 / OpenRouter / 公司中转"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>接口协议</label>
                      <Select
                        ariaLabel="接口协议"
                        value={activeCustomLlm.protocol}
                        options={[
                          { value: 'openai', label: 'OpenAI 兼容 (/chat/completions)' },
                          { value: 'anthropic', label: 'Anthropic 兼容 (/messages)' },
                        ]}
                        onChange={(v) =>
                          updateCustomLlmProfile(activeCustomLlm.id, {
                            protocol: v as CustomLlmProtocol,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.ccFieldGrid2}>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Base URL（到 /v1）</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={activeCustomLlm.baseUrl}
                        onChange={(e) =>
                          updateCustomLlmProfile(activeCustomLlm.id, { baseUrl: e.target.value })
                        }
                        placeholder="https://api.siliconflow.cn/v1"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>API Key（本地 Ollama 可留空）</label>
                      <input
                        type="password"
                        className={styles.input}
                        value={activeCustomLlm.apiKey}
                        onChange={(e) =>
                          updateCustomLlmProfile(activeCustomLlm.id, { apiKey: e.target.value })
                        }
                        placeholder="sk-..."
                      />
                    </div>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>
                      模型名称（支持下拉选取已拉取模型或直接手填 · 当前列表 {activeCustomLlm.fetchedModels.length} 个）
                    </label>
                    <div className={styles.ccModelRow}>
                      <Select
                        ariaLabel="从拉取列表选择 LLM 模型"
                        value={activeCustomLlm.model}
                        options={buildModelOptions(
                          activeCustomLlm.fetchedModels,
                          activeCustomLlm.model
                        )}
                        onChange={(model) =>
                          updateCustomLlmProfile(activeCustomLlm.id, { model })
                        }
                      />
                      <input
                        type="text"
                        className={styles.input}
                        value={activeCustomLlm.model}
                        onChange={(e) =>
                          updateCustomLlmProfile(activeCustomLlm.id, { model: e.target.value })
                        }
                        placeholder="或手动输入模型 ID"
                      />
                      <Button
                        variant="primary"
                        size="m"
                        disabled={fetchingCustomLlm}
                        onClick={() => void handleFetchCustomLlmModels()}
                      >
                        {fetchingCustomLlm ? '拉取中...' : '一键拉取模型'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {customLlmMsg ? (
                <div
                  className={clsx(
                    styles.statusText,
                    customLlmMsg.ok ? styles.statusOk : styles.statusErr
                  )}
                >
                  {customLlmMsg.text}
                </div>
              ) : (
                <div className={styles.dropzoneHint}>
                  激活自定义 LLM 后，首页顶部胶囊也会自动出现该配置档的模型下拉菜单，随时一键切换。
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* ==================== TAB 2: EMBEDDING & RAW RAG ==================== */}
      {step === 2 ? (
        <div className={styles.wizardCard}>
          <div className={styles.toolbarRow}>
            <div>
              <div className={styles.personaName}>本地记忆 · Raw RAG（自定义向量模型）</div>
              <div className={styles.personaDesc}>
                默认零配置走纯本地 BM25；配置硅基流动（免费 <span className={styles.codeInline}>BAAI/bge-m3</span>）或 Ollama / 任意 OpenAI 向量源后自动升级为语义向量 + BM25 混合召回。
              </div>
            </div>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={rag.enabled}
                onChange={(e) => updateRawRagConfig({ enabled: e.target.checked })}
              />
              <span>启用本地 Raw RAG</span>
            </label>
          </div>

          <details className={styles.compactDetails}>
            <summary>硅基流动免费向量模型（BAAI/bge-m3）1 元激活指南</summary>
            <ol className={styles.tutorialSteps} style={{ marginTop: 8 }}>
              <li>
                打开{' '}
                <a
                  className={styles.helperLink}
                  href="https://cloud.siliconflow.cn/"
                  target="_blank"
                  rel="noreferrer"
                >
                  cloud.siliconflow.cn
                </a>{' '}
                注册并登录，在充值页<strong>首充 1 元激活 API 权限</strong>（模型本身免费调用）。
              </li>
              <li>
                在「API 密钥」新建 <span className={styles.codeInline}>sk-...</span> 粘贴到下方，点击「一键拉取模型」或「测试向量连通性」。
              </li>
            </ol>
          </details>

          <div className={styles.fieldGroup}>
            <div className={styles.toolbarRow}>
              <label className={styles.fieldLabel}>向量模型配置档（CC-Switch · 点击切换）</label>
              <div className={styles.sessionChips}>
                {EMBEDDING_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.name}
                    type="button"
                    className={styles.actionChip}
                    onClick={() => {
                      addEmbeddingProfile({
                        name: tpl.name,
                        baseUrl: tpl.baseUrl,
                        apiKey: '',
                        model: tpl.model,
                      })
                      setEmbedMsg(null)
                    }}
                  >
                    + {tpl.name.split('（')[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.ccProfileStrip}>
              {rag.embeddingProfiles.map((p) => {
                const active = p.id === activeEmbed.id
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    className={clsx(
                      styles.ccProfileChip,
                      active && styles.ccProfileChipActive
                    )}
                    onClick={() => {
                      activateEmbeddingProfile(p.id)
                      setEmbedMsg(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        activateEmbeddingProfile(p.id)
                      }
                    }}
                  >
                    <span className={clsx(styles.statusDot, active && styles.statusDotOk)} />
                    <span>{p.name}</span>
                    {rag.embeddingProfiles.length > 1 ? (
                      <button
                        type="button"
                        className={styles.ccProfileDel}
                        aria-label={`删除 ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteEmbeddingProfile(p.id)
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          <div className={styles.ccEditorCard}>
            <div className={styles.ccFieldGrid2}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>配置档名称</label>
                <input
                  type="text"
                  className={styles.input}
                  value={activeEmbed.name}
                  onChange={(e) =>
                    updateEmbeddingProfile(activeEmbed.id, { name: e.target.value })
                  }
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Embedding Base URL</label>
                <input
                  type="text"
                  className={styles.input}
                  value={activeEmbed.baseUrl}
                  onChange={(e) =>
                    updateEmbeddingProfile(activeEmbed.id, { baseUrl: e.target.value })
                  }
                  placeholder="https://api.siliconflow.cn/v1"
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                API Key（本机 Ollama 免 Key；云端留空时自动退回纯本地 BM25）
              </label>
              <input
                type="password"
                className={styles.input}
                value={activeEmbed.apiKey}
                onChange={(e) =>
                  updateEmbeddingProfile(activeEmbed.id, { apiKey: e.target.value })
                }
                placeholder="粘贴 API Key（sk-...）"
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                向量模型名称（已拉取 {activeEmbed.fetchedModels.length} 个 · 向量模型自动置顶）
              </label>
              <div className={styles.ccModelRow}>
                <Select
                  ariaLabel="选择向量模型"
                  value={activeEmbed.model}
                  options={buildModelOptions(activeEmbed.fetchedModels, activeEmbed.model)}
                  onChange={(model) => updateEmbeddingProfile(activeEmbed.id, { model })}
                />
                <input
                  type="text"
                  className={styles.input}
                  value={activeEmbed.model}
                  onChange={(e) =>
                    updateEmbeddingProfile(activeEmbed.id, { model: e.target.value })
                  }
                  placeholder="如 BAAI/bge-m3"
                />
                <Button
                  variant="outlined"
                  size="m"
                  disabled={fetchingEmbed}
                  onClick={() => void handleFetchEmbeddingModels()}
                >
                  {fetchingEmbed ? '拉取中...' : '一键拉取模型'}
                </Button>
              </div>
            </div>

            <div className={styles.toolbarRow}>
              <Button
                variant="primary"
                size="m"
                disabled={testingEmbed}
                onClick={() => void handleTestEmbedding()}
              >
                {testingEmbed ? '测试中...' : '测试向量连通性'}
              </Button>
              <Button
                variant="outlined"
                size="m"
                disabled={agentBusy}
                onClick={() => void handleAgentConfigureRag()}
              >
                {agentBusy ? 'Agent 配置中...' : '🤖 用 DeepSeek Key 自动配置 RAG'}
              </Button>
            </div>
          </div>

          {embedMsg ? (
            <div className={clsx(styles.statusText, embedMsg.ok ? styles.statusOk : styles.statusErr)}>
              {embedMsg.text}
            </div>
          ) : null}

          {agentMsg ? (
            <div className={clsx(styles.statusText, agentMsg.ok ? styles.statusOk : styles.statusErr)}>
              {agentMsg.text}
            </div>
          ) : rag.lastAgentNote ? (
            <div className={styles.dropzoneHint}>
              上次 Agent 配置：{rag.lastAgentNote}（Top-K={rag.topK}，阈值={rag.minScore}，单块={rag.maxChunkChars}字）
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ==================== TAB 3: CUSTOM TTS & VOICE CLONING ==================== */}
      {step === 3 ? (
        <div className={styles.wizardCard}>
          <div className={styles.toolbarRow}>
            <div className={styles.personaName}>语音朗读引擎 · 自定义 TTS 与声音克隆</div>
            <div className={styles.checkboxRow}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={search}
                  onChange={(e) => setSearch(e.target.checked)}
                />
                <span>智能搜索</span>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={thinking}
                  onChange={(e) => setThinking(e.target.checked)}
                />
                <span>深度思考</span>
              </label>
            </div>
          </div>

          <div className={styles.providerSwitch3}>
            <button
              type="button"
              className={clsx(
                styles.providerCard,
                tts.engineMode === 'auto' && styles.providerCardActive
              )}
              onClick={() => setTtsEngineMode('auto')}
            >
              <div className={styles.personaTitleRow}>
                <span className={styles.personaName}>自动模式</span>
                {tts.engineMode === 'auto' ? <span className={styles.activeBadge}>当前</span> : null}
              </div>
              <span className={styles.capCardDesc}>
                有 DS Key 走官方流式，无 Key 自动走浏览器免费人声
              </span>
            </button>

            <button
              type="button"
              className={clsx(
                styles.providerCard,
                tts.engineMode === 'deepseek' && styles.providerCardActive
              )}
              onClick={() => setTtsEngineMode('deepseek')}
            >
              <div className={styles.personaTitleRow}>
                <span className={styles.personaName}>DeepSeek 官方</span>
                {tts.engineMode === 'deepseek' ? (
                  <span className={styles.activeBadge}>当前</span>
                ) : null}
              </div>
              <span className={styles.capCardDesc}>
                固定使用官方 /v1/tools/tts（海星 / 暗潮）
              </span>
            </button>

            <button
              type="button"
              className={clsx(
                styles.providerCard,
                tts.engineMode === 'custom' && styles.providerCardActive
              )}
              onClick={() => setTtsEngineMode('custom')}
            >
              <div className={styles.personaTitleRow}>
                <span className={styles.personaName}>自定义 TTS & 克隆</span>
                {tts.engineMode === 'custom' ? (
                  <span className={styles.activeBadge}>当前</span>
                ) : null}
              </div>
              <span className={styles.capCardDesc}>
                CosyVoice2 / OpenAI / Fish-Speech 参考音频克隆
              </span>
            </button>
          </div>

          {tts.engineMode !== 'custom' ? (
            <div className={styles.ccEditorCard}>
              <div className={styles.toolbarRow}>
                <div className={styles.fieldGroup} style={{ flex: 1, minWidth: 200 }}>
                  <label className={styles.fieldLabel}>默认朗读音色</label>
                  <Select
                    ariaLabel="选择默认朗读音色"
                    value={ttsVoice}
                    options={[
                      { value: 'stella', label: '海星（女声 · stella / 晓晓）' },
                      { value: 'tide', label: '暗潮（男声 · tide / 云希）' },
                    ]}
                    onChange={(v) => setTtsVoice(v as TtsVoice)}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>效果预览</label>
                  <Button variant="primary" size="m" onClick={handleTestTts}>
                    一键试听朗读
                  </Button>
                </div>
              </div>
              <div className={styles.dropzoneHint}>
                提示：选择「自定义 TTS & 克隆」即可接入硅基流动 CosyVoice2、OpenAI TTS 或本地 Fish-Speech 并上传 3–15 秒音频克隆专属音色。
              </div>
            </div>
          ) : (
            <>
              {/* CC-Switch TTS Profiles */}
              <div className={styles.fieldGroup}>
                <div className={styles.toolbarRow}>
                  <label className={styles.fieldLabel}>自定义 TTS 配置档（CC-Switch）</label>
                  <div className={styles.sessionChips}>
                    {CUSTOM_TTS_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.name}
                        type="button"
                        className={styles.actionChip}
                        onClick={() => {
                          addCustomTtsProfile({
                            name: tpl.name,
                            adapter: tpl.adapter,
                            baseUrl: tpl.baseUrl,
                            apiKey: '',
                            model: tpl.model,
                            voice: tpl.voice,
                            speed: tpl.speed,
                            fetchedModels: tpl.fetchedModels,
                          })
                          setTtsMsg(null)
                        }}
                      >
                        + {tpl.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.ccProfileStrip}>
                  {tts.profiles.map((p) => {
                    const active = p.id === activeTts.id
                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        className={clsx(
                          styles.ccProfileChip,
                          active && styles.ccProfileChipActive
                        )}
                        onClick={() => {
                          activateTtsProfile(p.id)
                          setTtsMsg(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            activateTtsProfile(p.id)
                          }
                        }}
                      >
                        <span className={clsx(styles.statusDot, active && styles.statusDotOk)} />
                        <span>{p.name}</span>
                        {tts.profiles.length > 1 ? (
                          <button
                            type="button"
                            className={styles.ccProfileDel}
                            aria-label={`删除 ${p.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteCustomTtsProfile(p.id)
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className={styles.ccEditorCard}>
                <div className={styles.ccFieldGrid2}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>配置档名称</label>
                    <input
                      type="text"
                      className={styles.input}
                      value={activeTts.name}
                      onChange={(e) =>
                        updateCustomTtsProfile(activeTts.id, { name: e.target.value })
                      }
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>接口协议适配</label>
                    <Select
                      ariaLabel="TTS 协议适配"
                      value={activeTts.adapter}
                      options={[
                        { value: 'siliconflow', label: '硅基流动 CosyVoice2（支持上传/参考克隆）' },
                        { value: 'openai', label: 'OpenAI / Edge-TTS 兼容 (/audio/speech)' },
                        { value: 'fish-speech', label: 'Fish-Speech / 本地克隆 (/tts)' },
                      ]}
                      onChange={(v) =>
                        updateCustomTtsProfile(activeTts.id, { adapter: v as CustomTtsAdapter })
                      }
                    />
                  </div>
                </div>

                <div className={styles.ccFieldGrid2}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>TTS Base URL</label>
                    <input
                      type="text"
                      className={styles.input}
                      value={activeTts.baseUrl}
                      onChange={(e) =>
                        updateCustomTtsProfile(activeTts.id, { baseUrl: e.target.value })
                      }
                      placeholder="https://api.siliconflow.cn/v1"
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>API Key（本机 Fish-Speech 可留空）</label>
                    <input
                      type="password"
                      className={styles.input}
                      value={activeTts.apiKey}
                      onChange={(e) =>
                        updateCustomTtsProfile(activeTts.id, { apiKey: e.target.value })
                      }
                      placeholder="sk-..."
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    语音模型（已拉取 {activeTts.fetchedModels.length} 个 · 语音模型置顶）
                  </label>
                  <div className={styles.ccModelRow}>
                    <Select
                      ariaLabel="选择 TTS 模型"
                      value={activeTts.model}
                      options={buildModelOptions(activeTts.fetchedModels, activeTts.model)}
                      onChange={(model) => updateCustomTtsProfile(activeTts.id, { model })}
                    />
                    <input
                      type="text"
                      className={styles.input}
                      value={activeTts.model}
                      onChange={(e) =>
                        updateCustomTtsProfile(activeTts.id, { model: e.target.value })
                      }
                      placeholder="模型 ID"
                    />
                    <Button
                      variant="outlined"
                      size="m"
                      disabled={fetchingTts}
                      onClick={() => void handleFetchTtsModels()}
                    >
                      {fetchingTts ? '拉取中...' : '一键拉取模型'}
                    </Button>
                  </div>
                </div>

                <div className={styles.ccFieldGrid2}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>默认音色 / Voice URI（未选克隆时使用）</label>
                    <input
                      type="text"
                      className={styles.input}
                      value={activeTts.voice}
                      onChange={(e) =>
                        updateCustomTtsProfile(activeTts.id, { voice: e.target.value })
                      }
                      placeholder="如 FunAudioLLM/CosyVoice2-0.5B:alex 或 alloy"
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>朗读语速</label>
                    <Select
                      ariaLabel="朗读语速"
                      value={String(activeTts.speed)}
                      options={[
                        { value: '0.85', label: '0.85x 舒缓' },
                        { value: '1', label: '1.0x 标准' },
                        { value: '1.15', label: '1.15x 轻快' },
                        { value: '1.3', label: '1.3x 快速' },
                      ]}
                      onChange={(v) =>
                        updateCustomTtsProfile(activeTts.id, { speed: Number(v) || 1 })
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Voice Cloning Workbench */}
              <div className={styles.ccEditorCard}>
                <div className={styles.toolbarRow}>
                  <div>
                    <div className={styles.capCardTitle}>声音克隆工作台（Voice Cloning）</div>
                    <div className={styles.capCardDesc}>
                      上传 3–15 秒清晰人声（本地存在浏览器 IndexedDB）并填写对应文字，朗读时自动带入参考音频或已注册的云端克隆 URI。
                    </div>
                  </div>
                  <Button variant="primary" size="s" onClick={handleTestTts}>
                    一键试听当前 TTS
                  </Button>
                </div>

                <div className={styles.ccFieldGrid2}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>1. 上传参考音频（WAV / MP3 / M4A）</label>
                    <div className={styles.toolbarRow}>
                      <input
                        ref={cloneFileInputRef}
                        type="file"
                        accept="audio/*,.wav,.mp3,.m4a,.ogg"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null
                          setCloneFile(file)
                          if (file && !cloneName.trim()) {
                            setCloneName(file.name.replace(/\.[^.]+$/, ''))
                          }
                        }}
                      />
                      <Button
                        variant="outlined"
                        size="m"
                        onClick={() => cloneFileInputRef.current?.click()}
                      >
                        {cloneFile ? `已选：${cloneFile.name.slice(0, 18)}` : '选择参考音频'}
                      </Button>
                      <input
                        type="text"
                        className={clsx(styles.input, styles.searchInput)}
                        value={cloneName}
                        onChange={(e) => setCloneName(e.target.value)}
                        placeholder="给音色起个名字"
                      />
                    </div>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>2. 参考音频对应的文字（克隆对齐用）</label>
                    <div className={styles.toolbarRow}>
                      <input
                        type="text"
                        className={clsx(styles.input, styles.searchInput)}
                        value={cloneRefText}
                        onChange={(e) => setCloneRefText(e.target.value)}
                        placeholder="这段参考音频里说的话..."
                      />
                      <Button
                        variant="outlined"
                        size="m"
                        disabled={savingClone}
                        onClick={() => void handleSaveClonedVoice()}
                      >
                        {savingClone ? '保存中...' : '保存音色'}
                      </Button>
                    </div>
                  </div>
                </div>

                {tts.clonedVoices.length > 0 ? (
                  <div className={styles.personaGrid}>
                    {tts.clonedVoices.map((voice) => {
                      const active = tts.activeClonedVoiceId === voice.id
                      return (
                        <div
                          key={voice.id}
                          className={clsx(
                            styles.voiceCloneItem,
                            active && styles.voiceCloneItemActive
                          )}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className={styles.personaTitleRow}>
                              <span className={styles.capCardTitle}>{voice.name}</span>
                              {active ? <span className={styles.activeBadge}>克隆已启用</span> : null}
                              {voice.remoteVoiceUri ? (
                                <span className={styles.sourceBadge}>云端 URI 已注册</span>
                              ) : null}
                            </div>
                            <div className={styles.capCardDesc}>
                              {voice.fileName}
                              {voice.referenceText ? ` · 「${voice.referenceText.slice(0, 36)}」` : ''}
                            </div>
                          </div>
                          <div className={styles.cardActions}>
                            <Button
                              variant={active ? 'primary' : 'outlined'}
                              size="s"
                              onClick={() => selectClonedVoice(active ? null : voice.id)}
                            >
                              {active ? '已启用' : '启用克隆'}
                            </Button>
                            <Button
                              variant="outlined"
                              size="s"
                              onClick={() => void handlePlaySampleVoice(voice)}
                            >
                              听原声
                            </Button>
                            {activeTts.adapter === 'siliconflow' ? (
                              <Button
                                variant="outlined"
                                size="s"
                                disabled={registeringVoiceId === voice.id}
                                onClick={() => void handleRegisterSiliconFlowVoice(voice)}
                              >
                                {registeringVoiceId === voice.id ? '注册中...' : '注册到硅基流动'}
                              </Button>
                            ) : null}
                            <Button
                              variant="dangerOutlined"
                              size="s"
                              onClick={() => void deleteClonedVoice(voice.id)}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className={styles.dropzoneHint}>
                    尚未上传克隆参考音频。不启用克隆音色时，将直接使用上方填写的「默认音色 / Voice URI」朗读。
                  </div>
                )}
              </div>

              {ttsMsg ? (
                <div className={clsx(styles.statusText, ttsMsg.ok ? styles.statusOk : styles.statusErr)}>
                  {ttsMsg.text}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* ==================== TAB 4: PERSONA ==================== */}
      {step === 4 ? (
        <div className={styles.wizardCard}>
          <div className={styles.toolbarRow}>
            <div>
              <div className={styles.personaName}>选择一个初始人格，或导入历史聊天</div>
              <div className={styles.personaDesc}>
                导入 DeepSeek ZIP / JSONL 时会自动将原始对话写入本地 Raw RAG 记忆库，边聊边召回。
              </div>
            </div>
            <div className={styles.cardActions}>
              <Button
                variant="outlined"
                size="s"
                onClick={() => {
                  closeOnboarding(true)
                  openPersonaManager('quiz')
                }}
              >
                问卷 + MBTI 从 0 捏人
              </Button>
              <Button
                variant="outlined"
                size="s"
                onClick={() => {
                  closeOnboarding(true)
                  openPersonaManager('import')
                }}
              >
                导入 ZIP / JSONL 人格
              </Button>
            </div>
          </div>

          <div className={styles.personaGrid}>
            {personas.map((p) => {
              const active = p.id === activePersonaId
              return (
                <div
                  key={p.id}
                  className={clsx(styles.personaCard, active && styles.personaCardActive)}
                  style={{ cursor: 'pointer' }}
                  onClick={() => selectPersona(p.id, true)}
                >
                  <div className={styles.personaCardInfo}>
                    <div className={styles.avatar}>{p.avatar}</div>
                    <div>
                      <div className={styles.personaTitleRow}>
                        <span className={styles.personaName}>{p.name}</span>
                        {active ? <span className={styles.activeBadge}>已选中</span> : null}
                      </div>
                      <div className={styles.personaDesc}>{p.tagline}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
