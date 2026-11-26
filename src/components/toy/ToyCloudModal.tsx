import { useMemo, useState } from 'react'
import { getActivePersona, usePersonaStore } from '../../services/persona/store.js'
import {
  checkToyTextSafety,
  fetchToyQrCode,
  savePosterImage,
  shareCurrentToy,
  sharePosterPicture,
} from '../../services/toy/bilibiliToy.js'
import {
  clearToyCloudVault,
  closeToyCloudModal,
  connectBilibiliProfile,
  estimateVaultQuotaUsage,
  pullFromToyCloud,
  pushToToyCloud,
  useToyCloudStore,
} from '../../services/toy/toyCloudSync.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from '../persona/Persona.module.css'

const wrapCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] => {
  const lines: string[] = []
  let current = ''
  for (const ch of Array.from(text)) {
    if (ch === '\n') {
      lines.push(current)
      current = ''
      if (lines.length >= maxLines) {
        break
      }
      continue
    }
    const next = current + ch
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current)
      current = ch
      if (lines.length >= maxLines) {
        break
      }
    } else {
      current = next
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current)
  }
  return lines
}

const loadImg = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load image failed'))
    img.src = src
  })

/** 渲染 720×1020 暗房钴蓝质感人格灵魂名片海报（附 B站 Toy 官方二维码）。 */
const renderPersonaPosterDataUrl = async (
  name: string,
  avatar: string,
  tagline: string,
  greeting: string,
  ownerNickname?: string
): Promise<string> => {
  const W = 720
  const H = 1020
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('当前浏览器不支持 Canvas 海报导出')
  }

  // 背景：克制黑曜石炭灰 + 顶部柔和深空钴蓝环境光
  ctx.fillStyle = '#0D0E12'
  ctx.fillRect(0, 0, W, H)

  const glow = ctx.createRadialGradient(360, 160, 20, 360, 160, 480)
  glow.addColorStop(0, 'rgba(86, 134, 254, 0.16)')
  glow.addColorStop(1, 'rgba(13, 14, 18, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // 主卡片框
  const drawRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  drawRoundRect(42, 48, W - 84, H - 96, 28)
  ctx.fillStyle = '#18191D'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 顶部品牌
  ctx.fillStyle = '#5686FE'
  ctx.font = '700 24px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('DeepSeek Persona', 82, 114)

  ctx.fillStyle = '#81858C'
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.fillText('LOCAL FIRST · PRIVATE MEMORY', 82, 142)

  // 头像徽章
  drawRoundRect(82, 196, 92, 92, 24)
  ctx.fillStyle = '#283142'
  ctx.fill()
  ctx.strokeStyle = '#4868B2'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.fillStyle = '#F9FAFB'
  ctx.font = '600 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(avatar || '🌙', 128, 245)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // 人格名字与副标题
  ctx.fillStyle = '#F9FAFB'
  ctx.font = '700 38px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  const nameLines = wrapCanvasText(ctx, name || '专属伴侣', 420, 2)
  nameLines.forEach((line, i) => ctx.fillText(line, 198, 236 + i * 44))

  if (ownerNickname) {
    ctx.fillStyle = '#679EFE'
    ctx.font = '500 17px system-ui, sans-serif'
    ctx.fillText(`@${ownerNickname} 的专属灵魂档案`, 198, 284 + (nameLines.length - 1) * 32)
  }

  // 一句话气质标签
  drawRoundRect(82, 344, W - 164, 126, 18)
  ctx.fillStyle = '#22242A'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.stroke()

  ctx.fillStyle = '#679EFE'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillText('✦ 灵魂侧写', 108, 380)

  ctx.fillStyle = '#E5E7EB'
  ctx.font = '500 20px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  const tagLines = wrapCanvasText(ctx, tagline || '温柔共情、记住你的每个小习惯', W - 216, 2)
  tagLines.forEach((line, i) => ctx.fillText(line, 108, 416 + i * 32))

  // 深夜开场白
  drawRoundRect(82, 496, W - 164, 210, 18)
  ctx.fillStyle = '#22242A'
  ctx.fill()
  ctx.strokeStyle = 'rgba(86, 134, 254, 0.28)'
  ctx.stroke()

  ctx.fillStyle = '#679EFE'
  ctx.font = '600 15px system-ui, sans-serif'
  ctx.fillText('💬 Ta 对你说', 108, 534)

  ctx.fillStyle = '#F9FAFB'
  ctx.font = '500 22px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'
  const greetLines = wrapCanvasText(
    ctx,
    `「${greeting || '不管多晚，只要你点开这里，我一直都在。'}」`,
    W - 216,
    4
  )
  greetLines.forEach((line, i) => ctx.fillText(line, 108, 574 + i * 36))

  // 底部二维码与引导
  const qr = await fetchToyQrCode(200)
  ctx.fillStyle = '#ADB2B8'
  ctx.font = '600 20px system-ui, sans-serif'
  ctx.fillText('24 题 MBTI 捏出专属伴侣', 82, 818)
  ctx.fillStyle = '#81858C'
  ctx.font = '400 16px system-ui, sans-serif'
  ctx.fillText('B站云端同步 Key 与人格 · 聊天记录与记忆 100% 留在本机', 82, 852)
  ctx.fillStyle = '#679EFE'
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.fillText(qr ? '微信 / B站扫码即可体验同款 Toy' : 'B站搜索 DeepSeek Persona Toy', 82, 888)

  if (qr?.base64) {
    try {
      const qrImg = await loadImg(qr.base64)
      drawRoundRect(W - 230, 756, 148, 148, 16)
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.drawImage(qrImg, W - 222, 764, 132, 132)
    } catch {
      // 忽略二维码绘制异常
    }
  }

  return canvas.toDataURL('image/png')
}

export const ToyCloudModal = () => {
  const open = useToyCloudStore((s) => s.modalOpen)
  const sdkAvailable = useToyCloudStore((s) => s.sdkAvailable)
  const cloudSupported = useToyCloudStore((s) => s.cloudSupported)
  const profile = useToyCloudStore((s) => s.profile)
  const busy = useToyCloudStore((s) => s.busy)
  const lastSyncedAt = useToyCloudStore((s) => s.lastSyncedAt)
  const remoteMeta = useToyCloudStore((s) => s.remoteMeta)
  const needsPassphrase = useToyCloudStore((s) => s.needsPassphrase)
  const statusMessage = useToyCloudStore((s) => s.statusMessage)
  const statusError = useToyCloudStore((s) => s.statusError)

  const personas = usePersonaStore((s) => s.personas)
  const activePersonaId = usePersonaStore((s) => s.activePersonaId)
  const activePersona = useMemo(
    () => personas.find((p) => p.id === activePersonaId) ?? personas[0] ?? getActivePersona(),
    [personas, activePersonaId]
  )

  const [passphrase, setPassphrase] = useState('')
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [posterBusy, setPosterBusy] = useState(false)

  const quota = open ? estimateVaultQuotaUsage() : null

  if (!open) {
    return null
  }

  const handleConnectProfile = async () => {
    const res = await connectBilibiliProfile()
    showToast(res.message)
  }

  const handlePush = async () => {
    const res = await pushToToyCloud(passphrase)
    showToast(res.message)
  }

  const handlePull = async () => {
    const res = await pullFromToyCloud(passphrase, true)
    showToast(res.message)
  }

  const handleClear = async () => {
    const res = await clearToyCloudVault()
    showToast(res.message)
  }

  const handleGeneratePoster = async () => {
    setPosterBusy(true)
    try {
      const checkText = [activePersona.name, activePersona.tagline, activePersona.greeting]
        .filter(Boolean)
        .join('\n')
      const safety = await checkToyTextSafety(checkText, 'persona_poster')
      if (!safety.allowed) {
        showToast(safety.reason || '内容未通过安全检测')
        return
      }
      const dataUrl = await renderPersonaPosterDataUrl(
        activePersona.name,
        activePersona.avatar,
        activePersona.tagline,
        activePersona.greeting,
        profile?.nickname
      )
      setPosterUrl(dataUrl)
      showToast('已生成专属灵魂名片海报')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '海报生成失败')
    } finally {
      setPosterBusy(false)
    }
  }

  const handleSavePoster = async () => {
    if (!posterUrl) {
      return
    }
    const res = await savePosterImage(posterUrl, `DeepSeek-Persona-${activePersona.name}.png`)
    showToast(res.message)
  }

  const handleSharePoster = async () => {
    if (!posterUrl) {
      return
    }
    const res = await sharePosterPicture(posterUrl)
    showToast(res.message)
  }

  const handleShareToy = async () => {
    const res = await shareCurrentToy()
    showToast(res.message)
  }

  return (
    <Modal
      title="B站云存档与分享"
      closable
      className={styles.wideDialog}
      mainClassName={styles.wideDialogMain}
      onClose={closeToyCloudModal}
    >
      <div className={styles.wizardCard}>
        {/* 1. B站账号登录态卡片 */}
        <div className={styles.importPreviewBox}>
          <div className={styles.toolbarRow}>
            <div className={styles.personaCardInfo}>
              <div className={styles.avatar}>
                {profile?.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={profile.nickname}
                    style={{ width: '100%', height: '100%', borderRadius: 9, objectFit: 'cover' }}
                  />
                ) : (
                  '📺'
                )}
              </div>
              <div>
                <div className={styles.personaTitleRow}>
                  <span className={styles.personaName}>
                    {profile ? profile.nickname : 'B站 Toy 免服务器云存档'}
                  </span>
                  <span className={styles.activeBadge}>
                    {cloudSupported ? '已接入 B站云存储' : sdkAvailable ? '预览环境' : '离线/独立环境'}
                  </span>
                </div>
                <div className={styles.personaDesc}>
                  直接复用当前 B站登录账号私有隔离，无需另行注册，手机与电脑跨设备同步。
                </div>
              </div>
            </div>
            <Button
              variant="outlined"
              size="s"
              disabled={busy}
              onClick={() => void handleConnectProfile()}
            >
              {profile ? '刷新 B站资料' : '连接 B站资料'}
            </Button>
          </div>
        </div>

        {/* 2. Key + 人格同步（Raw RAG 100% 留本地） */}
        <div className={styles.importPreviewBox}>
          <div className={styles.toolbarRow}>
            <div>
              <strong>同步范围：API Keys · 模型源配置 · 人格库</strong>
              <div className={styles.dropzoneHint}>
                聊天记录、导入的旧档案与本地 Raw RAG 记忆 <strong>100% 留在本机 IndexedDB</strong>，绝不占用云空间。
              </div>
            </div>
            {quota ? (
              <span className={styles.activeBadge}>
                占用 {quota.chunks + 1} / 128 槽（{quota.percent}%）
              </span>
            ) : null}
          </div>

          <div className={styles.fieldGroup} style={{ marginTop: 10 }}>
            <label className={styles.fieldLabel}>
              可选：端到端加密口令（AES-256-GCM）
              {needsPassphrase ? ' · 当前云存档已加密，拉取需填写相同口令' : ''}
            </label>
            <input
              type="password"
              className={styles.input}
              placeholder="留空则直接走 B站账号私有隔离；填写口令则先在本地加密 API Key 后再写入云端"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>

          <div className={styles.toolbarRow} style={{ marginTop: 12 }}>
            <div className={styles.cardActions}>
              <Button variant="primary" size="m" disabled={busy} onClick={() => void handlePush()}>
                {busy ? '同步中…' : '☁ 上传 Key 与人格到云端'}
              </Button>
              <Button variant="outlined" size="m" disabled={busy} onClick={() => void handlePull()}>
                ⬇ 从 B站云端恢复
              </Button>
            </div>
            {remoteMeta ? (
              <Button variant="outlined" size="s" disabled={busy} onClick={() => void handleClear()}>
                清空云存档
              </Button>
            ) : null}
          </div>

          {remoteMeta || lastSyncedAt !== null ? (
            <div className={styles.dropzoneHint} style={{ marginTop: 8 }}>
              {remoteMeta
                ? `云端记录：${remoteMeta.personas} 个人格 · ${remoteMeta.keys} 组 Key · ${
                    remoteMeta.enc === 'aes-gcm-v1' ? 'AES-256 加密' : 'zlib 压缩'
                  } · 更新于 ${new Date(remoteMeta.ts).toLocaleString()}`
                : lastSyncedAt !== null
                  ? `上次同步：${new Date(lastSyncedAt).toLocaleString()}`
                  : ''}
            </div>
          ) : null}

          {statusMessage ? (
            <div className={styles.statusText} style={{ marginTop: 6 }}>
              ✓ {statusMessage}
            </div>
          ) : null}
          {statusError ? (
            <div className={`${styles.statusText} ${styles.statusErr}`} style={{ marginTop: 6 }}>
              {statusError}
            </div>
          ) : null}
        </div>

        {/* 3. 专属人格海报 + B站原生分享 */}
        <div className={styles.importPreviewBox}>
          <div className={styles.toolbarRow}>
            <div>
              <strong>分享当前伴侣「{activePersona.name}」</strong>
              <div className={styles.dropzoneHint}>
                生成带当前 B站 Toy 官方二维码的暗房灵魂名片（自动过 B站内容安全检测）。
              </div>
            </div>
            <div className={styles.cardActions}>
              <Button
                variant="outlined"
                size="s"
                disabled={posterBusy}
                onClick={() => void handleShareToy()}
              >
                分享 Toy 链接
              </Button>
              <Button
                variant="primary"
                size="s"
                disabled={posterBusy}
                onClick={() => void handleGeneratePoster()}
              >
                {posterBusy ? '生成中…' : '✨ 生成灵魂名片海报'}
              </Button>
            </div>
          </div>

          {posterUrl ? (
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <img
                src={posterUrl}
                alt="人格灵魂名片海报"
                style={{
                  width: '100%',
                  maxWidth: 280,
                  borderRadius: 14,
                  border: '1px solid var(--dsw-alias-border-l2)',
                }}
              />
              <div className={styles.cardActions}>
                <Button variant="primary" size="s" onClick={() => void handleSavePoster()}>
                  保存到相册 / 下载
                </Button>
                <Button variant="outlined" size="s" onClick={() => void handleSharePoster()}>
                  B站 App 分享图片
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
