import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, TTS_SAMPLE_RATE, type TtsVoice } from '../api/speech.js'
import { useSettings } from '../settings.js'
import { synthesizeWithCustomTts, useCustomTtsStore } from './customTts.js'

/**
 * 朗读：同一时间只读一条回复。
 * - 已配置 DeepSeek API Key 时：调用官方 /v1/tools/tts 裸 PCM 流，边收边播（海星/暗潮音色）；
 * - 纯白嫖模式未配置 DS Key 时：自动无感降级到浏览器原生 Web Speech API（免费离线，支持微软晓晓/云希等中文人声）。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

const START_DELAY = 0.1

type ActivePlayback =
  | { kind: 'pcm'; controller: AbortController; context: AudioContext }
  | { kind: 'speech'; token: number }
  | { kind: 'audio'; controller: AbortController; audio: HTMLAudioElement; url: string }

let current: ActivePlayback | null = null
let speechSeq = 0
let browserFallbackNotified = false

const finishPcm = (controller: AbortController) => {
  if (current?.kind !== 'pcm' || current.controller !== controller) {
    return
  }
  void current.context.close()
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

const finishSpeech = (token: number) => {
  if (current?.kind !== 'speech' || current.token !== token) {
    return
  }
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

const finishAudio = (controller: AbortController) => {
  if (current?.kind !== 'audio' || current.controller !== controller) {
    return
  }
  current.audio.pause()
  URL.revokeObjectURL(current.url)
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（发送、停止生成、切换会话等场景调用） */
export const stopReadAloud = () => {
  if (!current) {
    return
  }
  if (current.kind === 'pcm') {
    const { controller } = current
    controller.abort()
    finishPcm(controller)
  } else if (current.kind === 'audio') {
    const { controller } = current
    controller.abort()
    finishAudio(controller)
  } else {
    const { token } = current
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    finishSpeech(token)
  }
}

/** 16-bit 小端 PCM 转成 Float32；奇数字节留到下一段 */
const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

/** 清理 Markdown 符号、代码块与链接，使浏览器本地朗读更自然。 */
const stripMarkdownForSpeech = (raw: string): string =>
  raw
    .replace(/```[\s\S]*?```/g, '（代码块已略过）')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]+/g, '')
    .replace(/\n{2,}/g, '。')
    .replace(/\s+/g, ' ')
    .trim()

const pickBrowserVoice = (voicePref: TtsVoice): SpeechSynthesisVoice | null => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null
  }
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) {
    return null
  }
  const zhVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'))
  const pool = zhVoices.length > 0 ? zhVoices : voices
  const preferredKeywords =
    voicePref === 'tide'
      ? ['yunxi', 'yunyang', 'yunjian', 'kangkang', 'male', '男']
      : ['xiaoxiao', 'xiaoyi', 'yaoyao', 'tingting', 'female', '女']
  for (const kw of preferredKeywords) {
    const match = pool.find((v) => v.name.toLowerCase().includes(kw))
    if (match) {
      return match
    }
  }
  return pool[0] ?? null
}

const playWithBrowserSpeech = (
  messageId: string,
  text: string,
  voicePref: TtsVoice,
  onError: (error: unknown) => void,
  onInfo?: (message: string) => void
) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onError(new Error('当前浏览器不支持本地语音朗读，填入 DeepSeek API Key 可使用官方 TTS'))
    return
  }
  const spoken = stripMarkdownForSpeech(text)
  if (!spoken) {
    onError(new Error('这段内容没有可朗读的文字'))
    return
  }
  const token = ++speechSeq
  current = { kind: 'speech', token }
  useReadAloud.setState({ messageId, status: 'playing' })

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(spoken)
  utterance.lang = 'zh-CN'
  utterance.rate = 1.02
  const voice = pickBrowserVoice(voicePref)
  if (voice) {
    utterance.voice = voice
  }
  utterance.onend = () => finishSpeech(token)
  utterance.onerror = (ev) => {
    if (ev.error !== 'interrupted' && ev.error !== 'canceled') {
      finishSpeech(token)
      onError(new Error(`本地朗读失败：${ev.error}`))
    } else {
      finishSpeech(token)
    }
  }
  window.speechSynthesis.speak(utterance)

  if (!browserFallbackNotified && onInfo) {
    browserFallbackNotified = true
    onInfo('当前使用浏览器本地免费朗读（填入 DeepSeek Key 可升级官方海星/暗潮音色）')
  }
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  if (error instanceof Error && !(error instanceof ApiError) && error.message) {
    return error.message
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return { key: 'ttsFailed' }
  }
}

/**
 * 开始朗读一条回复的正文；同一条正在朗读时调用等于停止。
 * 必须在点击事件中同步调用：AudioContext 需要用户手势才能出声。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void,
  onInfo?: (message: string) => void
) => {
  const reading = useReadAloud.getState().messageId
  stopReadAloud()
  if (reading === messageId) {
    return
  }

  const { apiKey, ttsVoice } = useSettings.getState()
  const ttsEngine = useCustomTtsStore.getState().engineMode

  if (ttsEngine === 'custom') {
    const spoken = stripMarkdownForSpeech(text)
    if (!spoken) {
      onError(new Error('这段内容没有可朗读的文字'))
      return
    }
    const controller = new AbortController()
    const audio = new Audio()
    current = { kind: 'audio', controller, audio, url: '' }
    useReadAloud.setState({ messageId, status: 'loading' })
    void (async () => {
      try {
        const blob = await synthesizeWithCustomTts(spoken, controller.signal)
        if (controller.signal.aborted) {
          return
        }
        const url = URL.createObjectURL(blob)
        if (current?.kind === 'audio' && current.controller === controller) {
          current.url = url
        }
        audio.src = url
        audio.onended = () => finishAudio(controller)
        audio.onerror = () => {
          finishAudio(controller)
          onError(new Error('自定义 TTS 返回的音频格式无法播放'))
        }
        useReadAloud.setState({ status: 'playing' })
        await audio.play()
      } catch (error) {
        if (!controller.signal.aborted) {
          finishAudio(controller)
          onError(error)
        }
      }
    })()
    return
  }

  if (!apiKey?.trim()) {
    if (ttsEngine === 'deepseek') {
      onError(new Error('已指定 DeepSeek 官方 TTS，但尚未填写 DeepSeek API Key'))
      return
    }
    playWithBrowserSpeech(messageId, text, ttsVoice, onError, onInfo)
    return
  }

  const controller = new AbortController()
  const context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  current = { kind: 'pcm', controller, context }
  useReadAloud.setState({ messageId, status: 'loading' })

  void (async () => {
    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)
    try {
      const stream = await synthesize(apiKey, text, ttsVoice, controller.signal)
      const reader = stream.getReader()
      controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        if (useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
        }
      }
      if (lastSource) {
        lastSource.onended = () => finishPcm(controller)
      } else {
        finishPcm(controller)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        finishPcm(controller)
        onError(error)
      }
    }
  })()
}
