import { useIsCompactSider, useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { openOnboarding, openPersonaManager, usePersonaStore } from '../../services/persona/store.js'
import {
  getActiveCustomProfile,
  updateCustomLlmProfile,
  updateProviderConfig,
  useProviderStore,
} from '../../services/providers/ourFreeModel.js'
import { useSettings } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import personaStyles from '../persona/Persona.module.css'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：极简留白——顶部单枚双段胶囊（左切人格，右 1 键切当前源拉取的模型）、开场白与输入框 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const isCompactSider = useIsCompactSider()
  const personas = usePersonaStore((s) => s.personas)
  const activePersonaId = usePersonaStore((s) => s.activePersonaId)
  const activePersona = personas.find((p) => p.id === activePersonaId) ?? personas[0]

  const apiKey = useSettings((s) => s.apiKey)
  const provider = useProviderStore()
  const activeCustom = getActiveCustomProfile()

  const greeting = activePersona?.greeting?.trim() || t('welcomeMessageChat250808')

  const customModelOptions = activeCustom
    ? [
        ...new Set([
          ...(activeCustom.model ? [activeCustom.model] : []),
          ...activeCustom.fetchedModels,
        ]),
      ]
    : []

  return (
    <div className={styles.container}>
      {isCompactSider ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        {activePersona ? (
          <div className={personaStyles.welcomeMinimal}>
            <div className={personaStyles.welcomePillGroup}>
              <button
                type="button"
                className={personaStyles.welcomePillLeft}
                onClick={() => openPersonaManager('manage')}
              >
                <span className={personaStyles.welcomePillAvatar}>{activePersona.avatar}</span>
                <span>{activePersona.name}</span>
              </button>
              <span className={personaStyles.welcomePillDivider} />
              {provider.chatProvider === 'ourfree' ? (
                <select
                  aria-label="快捷切换内置免费模型"
                  className={personaStyles.welcomeModelSelect}
                  value={provider.ourFreeModel}
                  onChange={(e) => updateProviderConfig({ ourFreeModel: e.target.value })}
                >
                  {provider.ourFreeModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : provider.chatProvider === 'custom' && activeCustom ? (
                <select
                  aria-label="快捷切换自定义模型"
                  className={personaStyles.welcomeModelSelect}
                  value={activeCustom.model}
                  onChange={(e) => updateCustomLlmProfile(activeCustom.id, { model: e.target.value })}
                >
                  {customModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {activeCustom.name} · {model}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className={personaStyles.welcomeModelSelect}
                  onClick={() => openOnboarding()}
                >
                  {apiKey ? 'DeepSeek 官方' : '配置 DeepSeek Key'}
                </button>
              )}
            </div>
          </div>
        ) : null}
        <div className={styles.greeting}>{greeting}</div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
