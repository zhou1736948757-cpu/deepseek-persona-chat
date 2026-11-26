import { execSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distToy = path.join(root, 'dist-toy')
const releaseDir = path.join(root, 'release')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

console.log('=== [build:toy] Building Bilibili Toy static bundle (dist-toy/) ===')
rmSync(distToy, { recursive: true, force: true })

execSync('pnpm exec rspack build -c rspack.config.ts', {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    TOY_BUILD: '1',
  },
})

const indexPath = path.join(distToy, 'index.html')
const html = readFileSync(indexPath, 'utf8')
if (!html.includes('toy-sdk.js')) {
  throw new Error('dist-toy/index.html 缺少 B站 Toy SDK 引入标签')
}
if (html.includes('src="/static/') || html.includes('href="/static/')) {
  throw new Error('dist-toy/index.html 检测到绝对路径 /static/，B站 /toy/<slug>/ 子路径下会加载失败')
}

// 打包成可直接上传 B站 Toy 创作中心的 ZIP（根目录直接为 index.html）
const files = {}
const walk = (dir, prefix = '') => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(full).isDirectory()) {
      walk(full, rel)
    } else {
      files[rel] = new Uint8Array(readFileSync(full))
    }
  }
}
walk(distToy)

mkdirSync(releaseDir, { recursive: true })
const zipPath = path.join(releaseDir, `DeepSeek-Persona-Bilibili-Toy-v${pkg.version}.zip`)
const zipped = zipSync(files, { level: 9 })
writeFileSync(zipPath, zipped)

const totalFiles = Object.keys(files).length
const zipMb = (zipped.byteLength / 1024 / 1024).toFixed(2)
console.log(`\n✓ B站 Toy 构建与打包完成！`)
console.log(`  目录：${distToy} (${totalFiles} 个文件)`)
console.log(`  上传包：${zipPath} (${zipMb} MB)`)
