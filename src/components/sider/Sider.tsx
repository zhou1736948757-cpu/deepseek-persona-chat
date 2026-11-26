import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { setSiderCollapsed, useSettings } from '../../services/settings.js'
import { openOnboarding, openPersonaManager, usePersonaStore } from '../../services/persona/store.js'
import { useProviderStore } from '../../services/providers/ourFreeModel.js'
import { openToyCloudModal, useToyCloudStore } from '../../services/toy/toyCloudSync.js'
import personaStyles from '../persona/Persona.module.css'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const personas = usePersonaStore((state) => state.personas)
  const activePersonaId = usePersonaStore((state) => state.activePersonaId)
  const activePersona = personas.find((p) => p.id === activePersonaId) ?? personas[0]
  const hasApiKey = Boolean(useSettings((state) => state.apiKey))
  const chatProvider = useProviderStore((state) => state.chatProvider)
  const activeCustomName = useProviderStore((state) =>
    state.customProfiles.find((p) => p.id === state.activeCustomProfileId)?.name
  )
  const toySdkAvailable = useToyCloudStore((state) => state.sdkAvailable)
  const toyCloudSynced = useToyCloudStore((state) => Boolean(state.lastSyncedAt || state.remoteMeta))
  const toyProfileName = useToyCloudStore((state) => state.profile?.nickname)
  const showToyEntry =
    (typeof __TOY_BUILD__ !== 'undefined' && __TOY_BUILD__) || toySdkAvailable
  const readyToChat = hasApiKey || chatProvider === 'ourfree' || chatProvider === 'custom'
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      {activePersona ? (
        <button
          type="button"
          className={personaStyles.siderPersonaRow}
          onClick={() => {
            openPersonaManager('manage')
            closeMobileSider()
          }}
        >
          <span className={personaStyles.avatar}>{activePersona.avatar}</span>
          <span className={personaStyles.siderPersonaMeta}>
            <span className={personaStyles.siderPersonaLabel} style={{ display: 'block' }}>
              当前人格
            </span>
            <span className={personaStyles.siderPersonaName} style={{ display: 'block' }}>
              {activePersona.name}
            </span>
          </span>
          <span className={personaStyles.siderChevron}>›</span>
        </button>
      ) : null}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button
          type="button"
          className={personaStyles.siderGuideBtn}
          onClick={() => {
            openOnboarding()
            closeMobileSider()
          }}
        >
          <span>
            {chatProvider === 'ourfree'
              ? '模型源 · 内置免费池'
              : chatProvider === 'custom'
                ? `模型源 · ${activeCustomName || '自定义'}`
                : '模型源 · DeepSeek'}
          </span>
          <span className={clsx(personaStyles.statusDot, readyToChat && personaStyles.statusDotOk)} />
        </button>
        {showToyEntry ? (
          <button
            type="button"
            className={personaStyles.siderGuideBtn}
            onClick={() => {
              openToyCloudModal()
              closeMobileSider()
            }}
          >
            <span>{toyProfileName ? `B站云存档 · ${toyProfileName}` : 'B站云存档 · 同步与分享'}</span>
            <span className={clsx(personaStyles.statusDot, toyCloudSynced && personaStyles.statusDotOk)} />
          </button>
        ) : null}
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
