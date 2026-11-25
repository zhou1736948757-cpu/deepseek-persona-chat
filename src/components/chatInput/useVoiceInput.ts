import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslationMessage } from '../../i18n/index.js'
import { transcribe } from '../../services/api/speech.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

const AVAILABLE = typeof window === 'undefined' || window.isSecureContext

type BrowserSpeechRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition

const getBrowserSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null
}

const describeRecordingError = (error: unknown): TranslationMessage => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return { key: 'voiceInputPermissionDenied' }
    }
    if (error.name === 'NotFoundError') {
      return { key: 'voiceInputNoDevice' }
    }
  }
  return { key: 'voiceInputFailed' }
}

/**
 * 语音输入：
 * - 已填 DeepSeek Key：调用官方 /v1/tools/asr；
 * - 白嫖模式未填 DS Key：自动降级到浏览器原生 SpeechRecognition（Chrome/Edge 免费可用）。
 */
export const useVoiceInput = (onText: (text: string) => void) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const recordingRef = useRef<Recording | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const operationRef = useRef(0)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const cancelOperation = useCallback(() => {
    operationRef.current++
    recordingRef.current?.cancel()
    recordingRef.current = null
    recognitionRef.current?.abort()
    recognitionRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const cancel = useCallback(() => {
    cancelOperation()
    setStatus('idle')
  }, [cancelOperation])

  const finish = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      return
    }
    const recording = recordingRef.current
    if (!recording) {
      cancel()
      return
    }
    const operation = operationRef.current
    recordingRef.current = null
    let controller: AbortController | null = null
    try {
      let audio: Blob | null
      try {
        audio = await recording.stop()
      } finally {
        recording.cancel()
      }
      if (operationRef.current !== operation || !audio) {
        return
      }
      controller = new AbortController()
      controllerRef.current = controller
      setStatus('transcribing')
      const text = await transcribe(useSettings.getState().apiKey ?? '', audio, controller.signal)
      if (controller.signal.aborted || operationRef.current !== operation) {
        return
      }
      if (text.trim()) {
        onTextRef.current(text.trim())
      } else {
        showToast({ key: 'voiceInputEmpty' })
      }
    } catch {
      if (operationRef.current === operation && !controller?.signal.aborted) {
        showToast({ key: 'voiceInputFailed' })
      }
    } finally {
      if (operationRef.current === operation) {
        controllerRef.current = null
        setStatus('idle')
      }
    }
  }, [cancel])

  const toggle = useCallback(async () => {
    if (!AVAILABLE) {
      return
    }
    if (status === 'recording') {
      await finish()
      return
    }
    if (status === 'transcribing') {
      cancel()
      return
    }

    const apiKey = useSettings.getState().apiKey
    if (!apiKey?.trim()) {
      const Ctor = getBrowserSpeechRecognitionCtor()
      if (!Ctor) {
        showToast('当前浏览器不支持免费本地语音识别，填入 DeepSeek Key 可开启官方语音输入')
        return
      }
      const operation = ++operationRef.current
      const recognition = new Ctor()
      recognition.lang = 'zh-CN'
      recognition.interimResults = false
      recognition.continuous = false
      let transcript = ''
      recognition.onresult = (event) => {
        const parts: string[] = []
        for (let i = 0; i < event.results.length; i += 1) {
          const item = event.results[i]?.[0]?.transcript
          if (item) {
            parts.push(item)
          }
        }
        transcript = parts.join('').trim()
      }
      recognition.onerror = (event) => {
        if (operationRef.current !== operation) {
          return
        }
        recognitionRef.current = null
        setStatus('idle')
        if (event.error !== 'aborted') {
          showToast(
            event.error === 'not-allowed'
              ? { key: 'voiceInputPermissionDenied' }
              : '本地语音识别未获取到声音，请重试'
          )
        }
      }
      recognition.onend = () => {
        if (operationRef.current !== operation) {
          return
        }
        recognitionRef.current = null
        setStatus('idle')
        if (transcript) {
          onTextRef.current(transcript)
        }
      }
      recognitionRef.current = recognition
      setStatus('recording')
      try {
        recognition.start()
      } catch {
        recognitionRef.current = null
        setStatus('idle')
        showToast('无法启动浏览器语音识别')
      }
      return
    }

    const operation = ++operationRef.current
    setStatus('recording')
    try {
      const recording = await startRecording(() => {
        if (operationRef.current === operation) {
          showToast({ key: 'voiceInputLimitReached' })
          void finish()
        }
      })
      if (operationRef.current !== operation) {
        recording.cancel()
        return
      }
      recordingRef.current = recording
    } catch (error) {
      if (operationRef.current === operation) {
        setStatus('idle')
        showToast(describeRecordingError(error))
      }
    }
  }, [status, finish, cancel])

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => cancelOperation, [cancelOperation])

  const getAnalyser = useCallback(() => recordingRef.current?.analyser ?? null, [])

  return { status, seconds, getAnalyser, toggle, cancel, available: AVAILABLE }
}
