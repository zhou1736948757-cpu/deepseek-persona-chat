import { useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import {
  useIsCompactSider,
  useIsMobile,
  useMobileViewport,
  usePreventPageScroll,
} from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { OnboardingWizard } from '../components/persona/OnboardingWizard.js'
import { PersonaManagerModal } from '../components/persona/PersonaManagerModal.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { ToyCloudModal } from '../components/toy/ToyCloudModal.js'
import { openOnboarding, usePersonaStore } from '../services/persona/store.js'
import { initBuiltInOurFreeModel, useProviderStore } from '../services/providers/ourFreeModel.js'
import { bindToySafeArea } from '../services/toy/bilibiliToy.js'
import { initToyCloudEnvironment } from '../services/toy/toyCloudSync.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const isCompactSider = useIsCompactSider()
  const locale = useSettings((state) => state.locale)
  // 手机与 Pad 竖屏（<1024px）以独立抽屉管理侧边栏开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isCompactSider
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端 / Pad 竖屏选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isCompactSider])

  useEffect(() => {
    const offSafeArea = bindToySafeArea()
    void initChat()
    void initBuiltInOurFreeModel()
    void initToyCloudEnvironment()
    // 仅当用户切换到 DeepSeek 官方模式且未填 Key 时才自动弹出引导；默认内置 OurFreeModel 开箱即用
    const hasDsKey = Boolean(useSettings.getState().apiKey)
    const isOurFree = useProviderStore.getState().chatProvider === 'ourfree'
    const done = usePersonaStore.getState().onboardingDone
    if (!hasDsKey && !isOurFree && !done) {
      openOnboarding()
    }
    return offSafeArea
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isCompactSider ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isCompactSider ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <PersonaManagerModal />
      <OnboardingWizard />
      <ToyCloudModal />
      <Toast />
    </>
  )
}
