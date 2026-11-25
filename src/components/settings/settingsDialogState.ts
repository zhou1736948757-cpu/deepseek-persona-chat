import { create } from 'zustand'
import { openOnboarding } from '../../services/persona/store.js'
import { getActiveCustomProfile, useProviderStore } from '../../services/providers/ourFreeModel.js'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 检查当前模型源是否就绪（OurFreeModel / 自定义 LLM 配置档 / DeepSeek Key）；未就绪时打开引导向导 */
export const ensureApiKey = () => {
  const provider = useProviderStore.getState()
  if (
    provider.chatProvider === 'ourfree' &&
    provider.ourFreeBaseUrl.trim() &&
    provider.ourFreeModel.trim()
  ) {
    return true
  }
  if (provider.chatProvider === 'custom') {
    const profile = getActiveCustomProfile()
    if (profile && profile.baseUrl.trim() && profile.model.trim()) {
      return true
    }
    openOnboarding()
    return false
  }
  if (useSettings.getState().apiKey) {
    return true
  }
  openOnboarding()
  return false
}
