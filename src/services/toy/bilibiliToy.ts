/**
 * B站 Toy JS SDK 类型声明与安全封装（0 后端、全端兼容）。
 * 严格遵循 B站 Toy JS SDK 规范：
 * - App 专属能力调用前一律 isSupport 检测
 * - toyOpenId 不写入任何埋点或公开日志
 * - checkInputSafety 严格处理 ok / rejected / unavailable 三态（unavailable 绝不放行）
 * - 云存储/分享/二维码严格校验 key 与 path 规则，处理 307044 限流
 */

export type ToyAbility =
  | 'navigate'
  | 'saveImageToAlbum'
  | 'share'
  | 'getQrCode'
  | 'sharePicture'
  | 'closeBrowser'
  | 'getUserProfile'
  | 'getCloudStorage'
  | 'setCloudStorage'
  | 'removeCloudStorage'
  | 'getAuthorProfile'
  | 'getAuthorVideos'
  | 'getAuthorRelation'
  | 'getVideoUserActions'
  | 'submitScore'
  | 'getRankList'
  | 'getMyRank'
  | 'requestCamera'
  | 'requestMicrophone'
  | 'stopMedia'
  | 'onContainerChange'
  | 'getContainerState'
  | 'setContainerMode'
  | 'onPlayerChange'
  | 'getPlayerState'
  | 'setPlayerState'
  | 'onPageClose'
  | 'checkInputSafety'
  | 'getSharedStorage'
  | 'setSharedStorage'
  | 'removeSharedStorage'
  | 'getChargeUnlock'
  | 'openChargePanel'
  | 'getAnnualReport'

export type ToyUserProfile = {
  avatar: string
  nickname: string
  /** 仅用于当前 Toy 内关联用户，绝不写入日志或埋点 */
  toyOpenId?: string
}

export type ToyContainerState = {
  deviceType: 'phone' | 'tablet' | 'desktop' | 'unknown'
  viewport: { width: number; height: number }
  safeArea: { top: number; right: number; bottom: number; left: number }
  orientation: 'portrait' | 'landscape'
  immersive: boolean
  changedFields: string[]
}

export type ToyCheckInputSafetyResp = {
  passed: boolean
  status: 'ok' | 'rejected' | 'unavailable'
}

export type ToySdkError = {
  type?: string
  code?: number
  message?: string
}

export interface BilibiliToySdk {
  isSupport(ability: ToyAbility): Promise<boolean>
  navigate(req: {
    type: 'video' | 'space' | 'search' | 'opus' | 'tribee' | 'toy'
    id: string
    extra?: Record<string, string>
  }): Promise<void>
  saveImageToAlbum(req: {
    url?: string
    base64Data?: string
    hintMsg?: string
  }): Promise<{ localPath: string }>
  share(req: { path: string }): Promise<void>
  getQrCode(req?: { path?: string; size?: number }): Promise<{ base64: string; url: string }>
  sharePicture(req: { url?: string; base64Data?: string }): Promise<void>
  closeBrowser(): Promise<void>
  getUserProfile(): Promise<ToyUserProfile>
  getCloudStorage(keys?: string[]): Promise<Record<string, string>>
  setCloudStorage(items: Record<string, string>): Promise<void>
  removeCloudStorage(keys: string[]): Promise<void>
  checkInputSafety(req: { text: string; scene?: string }): Promise<ToyCheckInputSafetyResp>
  requestMicrophone(): Promise<MediaStream>
  stopMedia(stream: MediaStream): Promise<void>
  onContainerChange(listener: (state: ToyContainerState) => void): () => void
  getContainerState(): Promise<ToyContainerState>
  setContainerMode(req: {
    orientation?: 'portrait' | 'landscape' | 'auto'
    immersive?: boolean
  }): Promise<void>
  onPageClose(listener: () => void): () => void
}

declare global {
  interface Window {
    toy?: BilibiliToySdk
  }
}

export const getToySdk = (): BilibiliToySdk | null => {
  if (typeof window === 'undefined' || !window.toy) {
    return null
  }
  return window.toy
}

export const isToyRuntime = (): boolean => getToySdk() !== null

export const isToyRateLimitError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') {
    return false
  }
  const e = err as ToySdkError
  return e.code === 307044 || (typeof e.message === 'string' && e.message.includes('307044'))
}

export const formatToyError = (err: unknown, fallback = '操作未能完成，请稍后重试'): string => {
  if (isToyRateLimitError(err)) {
    return '当前访问人数较多，B站云存储触发限流（307044），请稍候几秒再试；你的本地数据不受影响。'
  }
  if (!err || typeof err !== 'object') {
    return fallback
  }
  const e = err as ToySdkError
  if (e.type === 'not_logged_in' || e.type === 'unauthorized') {
    return '请先在 B站 登录账号后再使用云存档功能。'
  }
  if (e.type === 'unsupported') {
    return '当前预览环境暂不支持此 B站 Toy 原生能力，上传到 B站 Toy 后即可使用。'
  }
  if (e.type === 'user_cancelled' || e.type === 'denied') {
    return '已取消授权，未读取 B站账号资料。'
  }
  return e.message?.trim() || fallback
}

export const supportToyAbility = async (ability: ToyAbility): Promise<boolean> => {
  const sdk = getToySdk()
  if (!sdk || typeof sdk.isSupport !== 'function') {
    return false
  }
  try {
    return Boolean(await sdk.isSupport(ability))
  } catch {
    return false
  }
}

/** 绑定 B站 App 容器安全区（safeArea），Web / 桌面端自动静默跳过。 */
export const bindToySafeArea = (): (() => void) => {
  const sdk = getToySdk()
  if (!sdk) {
    return () => {}
  }

  let off: (() => void) | null = null
  let cancelled = false

  const applySafeArea = (state: ToyContainerState) => {
    const root = document.documentElement
    root.style.setProperty('--toy-safe-top', `${Math.max(0, state.safeArea?.top ?? 0)}px`)
    root.style.setProperty('--toy-safe-bottom', `${Math.max(0, state.safeArea?.bottom ?? 0)}px`)
    root.style.setProperty('--toy-safe-left', `${Math.max(0, state.safeArea?.left ?? 0)}px`)
    root.style.setProperty('--toy-safe-right', `${Math.max(0, state.safeArea?.right ?? 0)}px`)
  }

  void supportToyAbility('onContainerChange').then((supported) => {
    if (cancelled || !supported || !sdk.onContainerChange) {
      return
    }
    try {
      off = sdk.onContainerChange(applySafeArea)
    } catch {
      // 非 App 环境忽略
    }
  })

  return () => {
    cancelled = true
    if (off) {
      try {
        off()
      } catch {
        // ignore
      }
      off = null
    }
  }
}

/**
 * 玩家公开展示文本安全检测（人格名 / 简介 / 海报文案）。
 * 严格遵循规范：仅 passed === true && status === 'ok' 视为通过；unavailable 不可放行。
 */
export const checkToyTextSafety = async (
  text: string,
  scene = 'persona_profile'
): Promise<{ allowed: boolean; reason?: string }> => {
  const trimmed = text.trim()
  if (!trimmed) {
    return { allowed: true }
  }
  const sdk = getToySdk()
  if (!sdk) {
    return { allowed: true }
  }
  const supported = await supportToyAbility('checkInputSafety')
  if (!supported) {
    return { allowed: true }
  }

  // UTF-8 字节上限 16384
  const encoded = new TextEncoder().encode(trimmed)
  const safeText =
    encoded.byteLength > 16000
      ? new TextDecoder().decode(encoded.slice(0, 16000))
      : trimmed

  try {
    const res = await sdk.checkInputSafety({
      text: safeText,
      scene: scene.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64) || 'persona_profile',
    })
    if (res.passed && res.status === 'ok') {
      return { allowed: true }
    }
    if (res.status === 'rejected') {
      return { allowed: false, reason: '内容未通过 B站社区内容安全检测，请调整文案后再试。' }
    }
    return { allowed: false, reason: 'B站内容安全检测服务暂时不可用，请稍后再试。' }
  } catch (err) {
    return { allowed: false, reason: formatToyError(err, '内容安全检测未能完成，请稍后再试。') }
  }
}

/** 获取指向当前 Toy 首页的官方二维码（App 与 Web 均支持）。 */
export const fetchToyQrCode = async (size = 240): Promise<{ base64: string; url: string } | null> => {
  const sdk = getToySdk()
  if (!sdk || !(await supportToyAbility('getQrCode'))) {
    return null
  }
  const clampedSize = Math.max(80, Math.min(1024, Math.round(size)))
  try {
    return await sdk.getQrCode({ size: clampedSize })
  } catch {
    return null
  }
}

/** 拉起 B站 App 原生分享面板（指向当前 Toy 首页）。 */
export const shareCurrentToy = async (): Promise<{ ok: boolean; message: string }> => {
  const sdk = getToySdk()
  if (!sdk || !(await supportToyAbility('share'))) {
    return { ok: false, message: '请在 B站 App 内使用一键分享，或直接保存下方二维码海报。' }
  }
  try {
    await sdk.share({ path: 'index.html' })
    return { ok: true, message: '已唤起 B站分享面板' }
  } catch (err) {
    return { ok: false, message: formatToyError(err, '唤起分享失败，请稍后重试。') }
  }
}

/** 保存 Canvas 导出的 PNG dataUrl（App 走 saveImageToAlbum，Web 走浏览器下载）。 */
export const savePosterImage = async (
  base64Data: string,
  fileName: string
): Promise<{ ok: boolean; message: string }> => {
  const sdk = getToySdk()
  if (sdk && (await supportToyAbility('saveImageToAlbum'))) {
    if (base64Data.length > 5_000_000) {
      return { ok: false, message: '海报图片体积超限，请稍后重试。' }
    }
    try {
      await sdk.saveImageToAlbum({
        base64Data,
        hintMsg: '需要相册权限来保存你的人格灵魂名片海报',
      })
      return { ok: true, message: '已保存到手机相册' }
    } catch (err) {
      return { ok: false, message: formatToyError(err, '保存到相册失败，请检查相册权限。') }
    }
  }

  // Web 端标准下载兜底
  try {
    const a = document.createElement('a')
    a.href = base64Data
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    return { ok: true, message: `已下载海报 ${fileName}` }
  } catch {
    return { ok: false, message: '保存海报失败，请右键图片另存为。' }
  }
}

/** 在 B站 App 内直接分享海报图片。 */
export const sharePosterPicture = async (
  base64Data: string
): Promise<{ ok: boolean; message: string }> => {
  const sdk = getToySdk()
  if (!sdk || !(await supportToyAbility('sharePicture'))) {
    return { ok: false, message: '当前环境不支持原生图片分享，请先点击「保存海报」。' }
  }
  if (base64Data.length > 2_000_000) {
    return { ok: false, message: '图片体积超过 2MB 端内分享上限。' }
  }
  try {
    await sdk.sharePicture({ base64Data })
    return { ok: true, message: '已唤起图片分享' }
  } catch (err) {
    return { ok: false, message: formatToyError(err, '图片分享失败，请稍后重试。') }
  }
}
