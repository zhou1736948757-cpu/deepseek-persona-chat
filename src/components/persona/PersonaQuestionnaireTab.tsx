import clsx from 'clsx'
import { useMemo, useState } from 'react'
import type { TtsVoice } from '../../services/api/speech.js'
import { addManualMemoryChunk } from '../../services/memory/rawRag.js'
import {
  computeMbtiResult,
  countAnsweredQuestions,
  createInitialQuizState,
  polishQuizPersonaWithActiveModel,
  QUIZ_QUESTIONS,
  SECTION_META,
  synthesizePersonaFromQuiz,
  type QuizQuestion,
  type QuizState,
} from '../../services/persona/questionnaire.js'
import {
  closePersonaManager,
  createPersona,
  openPersonaManager,
} from '../../services/persona/store.js'
import { useProviderStore } from '../../services/providers/ourFreeModel.js'
import { setThinkingEffort, useSettings, type ThinkingEffort } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Persona.module.css'

const TOTAL = QUIZ_QUESTIONS.length // 24 题

/**
 * 极简单题聚焦式 24 题深度问卷（12 题设定 + 12 题 MBTI 量表）+ 终幕人格档案生成。
 */
export const PersonaQuestionnaireTab = () => {
  const [quiz, setQuiz] = useState<QuizState>(createInitialQuizState)
  /** 0..23 对应第 1..24 题；24 表示终幕预览页 */
  const [cursor, setCursor] = useState<number>(0)
  const [polishing, setPolishing] = useState(false)
  const [polished, setPolished] = useState<{
    tagline: string
    systemPrompt: string
    greeting: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chatProvider = useProviderStore((s) => s.chatProvider)
  const apiKey = useSettings((s) => s.apiKey)

  const isReview = cursor >= TOTAL
  const current: QuizQuestion | null = isReview ? null : QUIZ_QUESTIONS[cursor]

  const mbti = useMemo(() => computeMbtiResult(quiz), [quiz])
  const answeredCount = useMemo(() => countAnsweredQuestions(quiz), [quiz])
  const draft = useMemo(() => {
    const base = synthesizePersonaFromQuiz(quiz)
    return polished ? { ...base, ...polished } : base
  }, [quiz, polished])

  const progressPct = isReview ? 100 : Math.round(((cursor + 1) / TOTAL) * 100)

  const selectOption = (q: QuizQuestion, value: string) => {
    setPolished(null)
    setQuiz((prev) => {
      const existing = prev.choices[q.id] ?? []
      const nextList =
        q.kind === 'multi'
          ? existing.includes(value)
            ? existing.filter((v) => v !== value)
            : [...existing, value]
          : [value]
      return { ...prev, choices: { ...prev.choices, [q.id]: nextList } }
    })
    // 纯二选一的 MBTI 题点选后自动平滑推进到下一题，24 题刷起来极顺滑
    if (q.kind === 'mbti' && cursor < TOTAL) {
      setTimeout(() => {
        setCursor((c) => (c === q.index - 1 ? Math.min(TOTAL, c + 1) : c))
      }, 140)
    }
  }

  const updateText = (id: string, value: string) => {
    setPolished(null)
    setQuiz((prev) => ({ ...prev, texts: { ...prev.texts, [id]: value } }))
  }

  const handlePolish = async () => {
    if (chatProvider === 'deepseek' && !apiKey) {
      setError('当前为 DeepSeek 官方模式且未填 Key，可切回内置免费模型或直接创建。')
      return
    }
    setPolishing(true)
    setError(null)
    try {
      const controller = new AbortController()
      const res = await polishQuizPersonaWithActiveModel(draft, mbti, controller.signal)
      setPolished(res)
      showToast('已用当前模型润色人格设定与开场白')
    } catch (err) {
      setError(`润色失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPolishing(false)
    }
  }

  const handleCommit = async (openEditor = false) => {
    const created = createPersona(draft, true)
    setThinkingEffort(quiz.thinkingEffort)
    if (draft.memoryNotes.trim()) {
      await addManualMemoryChunk(created.id, draft.memoryNotes, '24题深度问卷档案').catch(() => {})
    }
    if (openEditor) {
      showToast(`已生成人格「${created.name}」，可继续微调`)
      openPersonaManager('edit', created.id)
    } else {
      showToast(`已生成并启用人格「${created.name}」（${mbti.code}）`)
      closePersonaManager()
    }
  }

  return (
    <>
      {/* 顶部极简章节导航 + 细进度条 */}
      <div className={styles.quizTop}>
        <div className={styles.quizNavRow}>
          <div className={styles.quizSections}>
            {SECTION_META.map((sec) => {
              const active = !isReview && current?.section === sec.id
              return (
                <button
                  key={sec.id}
                  type="button"
                  className={clsx(styles.quizSectionBtn, active && styles.quizSectionBtnActive)}
                  onClick={() => setCursor(sec.range[0] - 1)}
                >
                  {sec.label}
                </button>
              )
            })}
            <button
              type="button"
              className={clsx(styles.quizSectionBtn, isReview && styles.quizSectionBtnActive)}
              onClick={() => setCursor(TOTAL)}
            >
              生成档案
            </button>
          </div>
          <span className={styles.quizCounter}>
            {isReview ? `已完成 ${answeredCount} / ${TOTAL} 题` : `第 ${String(cursor + 1).padStart(2, '0')} / ${TOTAL} 题`}
          </span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {!isReview && current ? (
        <div className={styles.quizStage}>
          <div className={styles.quizEyebrow}>
            {current.sectionTitle}
            {current.kind === 'multi' ? ' · 可多选' : current.kind === 'mbti' ? ' · 点选自动下一题' : ''}
          </div>
          <h3 className={styles.quizQuestionTitle}>{current.title}</h3>
          {current.subtitle ? <p className={styles.quizQuestionSub}>{current.subtitle}</p> : null}

          {current.options ? (
            <div
              className={clsx(
                styles.optionGrid,
                (current.kind === 'mbti' || current.options.length <= 2) && styles.optionGridSingle
              )}
            >
              {current.options.map((opt) => {
                const selected = (quiz.choices[current.id] ?? []).includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={clsx(styles.optionCard, selected && styles.optionCardSelected)}
                    onClick={() => selectOption(current, opt.value)}
                  >
                    <div className={styles.optionLabel}>
                      <span>{opt.label}</span>
                      {selected ? <span className={styles.optionCheck}>✓</span> : null}
                    </div>
                    {opt.desc ? <div className={styles.optionDesc}>{opt.desc}</div> : null}
                  </button>
                )
              })}
            </div>
          ) : null}

          {current.id === 'q01_name' ? (
            <div className={styles.formGrid} style={{ gridTemplateColumns: '1fr 1fr' }}>
              <input
                type="text"
                className={styles.input}
                placeholder="自定义第一眼气质（可选，如：慵懒复古、略带神秘感…）"
                value={quiz.texts.q01_vibe ?? ''}
                onChange={(e) => updateText('q01_vibe', e.target.value)}
              />
              <input
                type="text"
                className={styles.input}
                placeholder={current.customPlaceholder ?? '角色名字…'}
                value={quiz.texts[current.id] ?? ''}
                onChange={(e) => updateText(current.id, e.target.value)}
              />
            </div>
          ) : current.allowCustom ? (
            <input
              type="text"
              className={styles.input}
              placeholder={current.customPlaceholder ?? '自由补充…'}
              value={quiz.texts[current.id] ?? ''}
              onChange={(e) => updateText(current.id, e.target.value)}
            />
          ) : null}

          {/* 第 12 题顺带提供极简音色、思考深度与工具开关 */}
          {current.id === 'q12_memory_pref' ? (
            <div className={styles.toolbarRow}>
              <div style={{ minWidth: 165 }}>
                <Select
                  ariaLabel="选择默认 TTS 音色"
                  value={quiz.ttsVoice}
                  options={[
                    { value: 'stella', label: '音色：海星（女声）' },
                    { value: 'tide', label: '音色：暗潮（男声）' },
                  ]}
                  onChange={(v) => setQuiz((prev) => ({ ...prev, ttsVoice: v as TtsVoice }))}
                />
              </div>
              <div style={{ minWidth: 150 }}>
                <Select
                  ariaLabel="选择默认思考深度"
                  value={quiz.thinkingEffort}
                  options={[
                    { value: 'low', label: '思考深度：低（精简）' },
                    { value: 'medium', label: '思考深度：中（均衡）' },
                    { value: 'high', label: '思考深度：高（深思）' },
                  ]}
                  onChange={(v) => setQuiz((prev) => ({ ...prev, thinkingEffort: v as ThinkingEffort }))}
                />
              </div>
              <div className={styles.checkboxRow}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={quiz.defaultSearch}
                    onChange={(e) => setQuiz((prev) => ({ ...prev, defaultSearch: e.target.checked }))}
                  />
                  <span>智能搜索</span>
                </label>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={quiz.defaultThinking}
                    onChange={(e) => setQuiz((prev) => ({ ...prev, defaultThinking: e.target.checked }))}
                  />
                  <span>深度思考</span>
                </label>
              </div>
            </div>
          ) : null}

          <div className={styles.quizFooter}>
            <div className={styles.cardActions}>
              <Button
                variant="outlined"
                size="m"
                disabled={cursor === 0}
                onClick={() => setCursor((c) => Math.max(0, c - 1))}
              >
                上一题
              </Button>
              <button
                type="button"
                className={styles.subtleLink}
                onClick={() => setCursor(TOTAL)}
              >
                跳过余题，直接预览档案
              </button>
            </div>
            <Button
              variant="primary"
              size="m"
              onClick={() => setCursor((c) => Math.min(TOTAL, c + 1))}
            >
              {cursor === TOTAL - 1 ? '查看完整人格档案' : '下一题'}
            </Button>
          </div>
        </div>
      ) : (
        /* 终幕：完整人格名片 + 4 维 MBTI 真实得分条 + 生成 */
        <div className={styles.quizStage}>
          <div className={styles.mbtiResultCard}>
            <div className={styles.toolbarRow}>
              <div className={styles.personaCardInfo}>
                <div className={clsx(styles.avatar, styles.avatarLarge)}>{draft.avatar}</div>
                <div>
                  <div className={styles.personaTitleRow}>
                    <span className={styles.personaName}>{draft.name}</span>
                    <span className={styles.activeBadge}>
                      {mbti.code} · {mbti.archetype.title}
                    </span>
                  </div>
                  <div className={styles.personaDesc}>{draft.tagline}</div>
                </div>
              </div>
              <Button
                variant="outlined"
                size="s"
                disabled={polishing}
                onClick={() => void handlePolish()}
              >
                {polishing ? '润色中…' : '✨ 模型润色'}
              </Button>
            </div>

            <div className={styles.mbtiBars}>
              {mbti.axes.map((a) => (
                <div key={a.axis} className={styles.mbtiBarRow}>
                  <div className={styles.mbtiBarLabels}>
                    <span>
                      {a.left} {a.leftPct}%
                    </span>
                    <span>
                      {a.rightPct}% {a.right}
                    </span>
                  </div>
                  <div className={styles.mbtiTrack}>
                    <div className={styles.mbtiFillLeft} style={{ width: `${a.leftPct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error ? <div className={clsx(styles.statusText, styles.statusErr)}>{error}</div> : null}

          <div className={styles.msgPreviewList}>
            <div className={styles.msgPreviewItem}>
              <span className={styles.msgPreviewSpeaker}>开场白：</span>
              {draft.greeting}
            </div>
            <div className={styles.msgPreviewItem}>
              <span className={styles.msgPreviewSpeaker}>人格设定：</span>
              {draft.systemPrompt}
            </div>
          </div>

          <div className={styles.quizFooter}>
            <Button variant="outlined" size="m" onClick={() => setCursor(TOTAL - 1)}>
              返回修改题目
            </Button>
            <div className={styles.cardActions}>
              <Button variant="outlined" size="m" onClick={() => void handleCommit(true)}>
                生成并微调
              </Button>
              <Button variant="primary" size="m" onClick={() => void handleCommit(false)}>
                生成并立即开聊
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
