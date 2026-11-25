import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeBuiltInOfm, createOfmMiddleware, ensureBuiltInOfm } from './ofm-bridge.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const PREFERRED_PORT = Number(process.env.PORT || 8090)
const SHUTDOWN_TOKEN = (process.env.APP_SHUTDOWN_TOKEN || '').trim()
const RUNTIME_INFO_FILE = (process.env.APP_RUNTIME_INFO_FILE || '').trim()

const pkg = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  } catch {
    return { version: '0.1.4' }
  }
})()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

const ofmMiddleware = createOfmMiddleware()
let ofmService = null
try {
  ofmService = await ensureBuiltInOfm()
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[App] 内置 OurFreeModel 初始化失败（仍可正常使用 DeepSeek/自定义模型）：', err instanceof Error ? err.message : String(err))
}

let actualPort = PREFERRED_PORT
let shuttingDown = false

const cleanupRuntimeFile = () => {
  if (!RUNTIME_INFO_FILE) return
  try {
    fs.unlinkSync(RUNTIME_INFO_FILE)
  } catch {
    // ignore
  }
}

const gracefulExit = async () => {
  if (shuttingDown) return
  shuttingDown = true
  cleanupRuntimeFile()
  try {
    server.close()
  } catch {
    // ignore
  }
  await closeBuiltInOfm()
  process.exit(0)
}

const server = http.createServer((req, res) => {
  const reqUrl = req.url || '/'
  const reqPath = reqUrl.split('?')[0]

  if (reqPath === '/__app/info') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(
      JSON.stringify({
        ok: true,
        pid: process.pid,
        version: pkg.version || '0.1.4',
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}/`,
        ofmRunning: Boolean(ofmService),
        managementUrl: ofmService?.managementUrl || '',
      })
    )
    return
  }

  if (reqPath === '/__app/shutdown' && req.method === 'POST') {
    const auth = req.headers['x-app-token']
    if (SHUTDOWN_TOKEN && auth !== SHUTDOWN_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true }))
    setTimeout(() => void gracefulExit(), 60)
    return
  }

  void ofmMiddleware(req, res, () => {
    const safeRel = path.normalize(reqPath === '/' ? '/index.html' : reqPath).replace(/^(\.\.[/\\])+/, '')
    let filePath = path.join(DIST, safeRel)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST, 'index.html')
    }
    const ext = path.extname(filePath).toLowerCase()
    const isHtml = ext === '.html'
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    fs.createReadStream(filePath).pipe(res)
  })
})

const listenWithFallback = (startPort, maxTries = 60) =>
  new Promise((resolve, reject) => {
    let port = startPort
    const tryListen = () => {
      const onError = (err) => {
        server.off('listening', onListening)
        if (err && err.code === 'EADDRINUSE' && port - startPort < maxTries) {
          port += 1
          tryListen()
        } else {
          reject(err)
        }
      }
      const onListening = () => {
        server.off('error', onError)
        const addr = server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    }
    tryListen()
  })

actualPort = await listenWithFallback(PREFERRED_PORT)

const runtimeInfo = {
  pid: process.pid,
  port: actualPort,
  url: `http://127.0.0.1:${actualPort}/`,
  managementUrl: ofmService?.managementUrl || '',
  startedAt: Date.now(),
}

if (RUNTIME_INFO_FILE) {
  try {
    fs.mkdirSync(path.dirname(RUNTIME_INFO_FILE), { recursive: true })
    fs.writeFileSync(RUNTIME_INFO_FILE, JSON.stringify(runtimeInfo, null, 2), 'utf8')
  } catch {
    // ignore
  }
}

process.once('SIGINT', () => void gracefulExit())
process.once('SIGTERM', () => void gracefulExit())

// eslint-disable-next-line no-console
console.log(`READY ${JSON.stringify(runtimeInfo)}`)
// eslint-disable-next-line no-console
console.log(`DeepSeek Persona + Built-in OurFreeModel running at ${runtimeInfo.url}`)
