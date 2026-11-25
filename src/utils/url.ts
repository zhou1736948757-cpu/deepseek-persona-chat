/** 来自服务端或归档的链接会渲染成 href 或交给 window.open，只接受 HTTP / HTTPS。 */
export const isWebUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
