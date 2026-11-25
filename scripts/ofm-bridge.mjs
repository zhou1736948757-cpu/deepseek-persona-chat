import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import http from 'node:http'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OFM_SERVICE_PATH = path.join(ROOT, 'vendor', 'dsh-our-free-model', 'packages', 'standalone', 'service.mjs')

const resolveOfmDataDir = () => {
  const fromEnv = (process.env.OFM_DATA_DIR || process.env.OFM_HOME || '').trim()
  if (fromEnv) {
    return path.resolve(fromEnv)
  }
  return path.join(ROOT, '.ofm-data')
}

let bridgePromise = null
let activeService = null

const readForwardKey = (keyFile) => {
  try {
    const raw = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
    return typeof raw.forwardKey === 'string' ? raw.forwardKey : ''
  } catch {
    return ''
  }
}

/** 主动关闭内置 OurFreeModel 服务，释放监听端口与数据锁。 */
export async function closeBuiltInOfm() {
  if (!activeService) {
    return
  }
  const s = activeService
  activeService = null
  bridgePromise = null
  await s.close().catch(() => {})
}

/** 启动项目内置的 Our Free Model 独立服务（仅监听 127.0.0.1），端口冲突时自动退回随机可用端口。 */
export async function ensureBuiltInOfm() {
  if (bridgePromise) {
    return bridgePromise
  }
  bridgePromise = (async () => {
    const dataDir = resolveOfmDataDir()
    fs.mkdirSync(dataDir, { recursive: true })
    const mod = await import(pathToFileURL(OFM_SERVICE_PATH).href)
    const preferredPort = Number(process.env.OFM_PORT || 18900)
    let service
    try {
      service = await mod.startStandalone({
        dataDir,
        host: '127.0.0.1',
        port: Number.isFinite(preferredPort) && preferredPort >= 0 ? preferredPort : 18900,
      })
    } catch (err) {
      if (err && (err.code === 'EADDRINUSE' || String(err.message || '').includes('EADDRINUSE'))) {
        service = await mod.startStandalone({
          dataDir,
          host: '127.0.0.1',
          port: 0,
        })
      } else {
        throw err
      }
    }
    activeService = service
    const shutdown = () => {
      void closeBuiltInOfm()
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    process.once('exit', shutdown)
    // eslint-disable-next-line no-console
    console.log(
      `[OurFreeModel] 内置免费模型服务已启动：${service.url}/v1（v${service.version}）`
    )
    return service
  })().catch((err) => {
    bridgePromise = null
    throw err
  })
  return bridgePromise
}

/**
 * 为 Rspack DevServer / 生产 HTTP 服务器提供 /__ofm/* 同源代理：
 * - GET /__ofm/status 返回内置服务状态与控制台地址（不暴露 forwardKey）
 * - /__ofm/v1/* 透明转发到本地 OurFreeModel 服务并自动附带服务端 forwardKey
 */
export function createOfmMiddleware() {
  // 后台尽早拉起内置服务，不阻塞前端首屏编译
  void ensureBuiltInOfm().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[OurFreeModel] 启动失败：', err instanceof Error ? err.message : String(err))
  })

  return async function ofmMiddleware(req, res, next) {
    const url = req.url || ''
    if (!url.startsWith('/__ofm/')) {
      return next()
    }

    let service
    try {
      service = await ensureBuiltInOfm()
    } catch (err) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          running: false,
          error: err instanceof Error ? err.message : String(err),
        })
      )
      return
    }

    if (url === '/__ofm/status' || url.startsWith('/__ofm/status?')) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(
        JSON.stringify({
          running: true,
          version: service.version,
          apiBase: '/__ofm/v1',
          localApiUrl: `${service.url}/v1`,
          managementUrl: service.managementUrl,
        })
      )
      return
    }

    if (url.startsWith('/__ofm/v1/')) {
      const targetPath = url.slice('/__ofm'.length)
      const forwardKey = readForwardKey(service.keyFile)
      const targetUrl = new URL(targetPath, service.url)

      const headers = {}
      for (const [k, v] of Object.entries(req.headers)) {
        const lower = k.toLowerCase()
        if (lower === 'host' || lower === 'connection' || lower === 'authorization' || lower === 'content-length') {
          continue
        }
        if (v !== undefined) {
          headers[k] = v
        }
      }
      if (forwardKey) {
        headers.authorization = `Bearer ${forwardKey}`
      }

      const proxyReq = http.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path: targetUrl.pathname + targetUrl.search,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          res.statusCode = proxyRes.statusCode || 502
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v !== undefined && k.toLowerCase() !== 'transfer-encoding') {
              res.setHeader(k, v)
            }
          }
          res.setHeader('Cache-Control', 'no-store')
          proxyRes.pipe(res)
        }
      )

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: { message: `内置 OurFreeModel 转发失败：${err.message}` } }))
        } else {
          res.end()
        }
      })

      req.on('close', () => {
        if (!res.writableEnded) {
          proxyReq.destroy()
        }
      })

      if (req.method === 'GET' || req.method === 'HEAD') {
        proxyReq.end()
      } else {
        req.pipe(proxyReq)
      }
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
