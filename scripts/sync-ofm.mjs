import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OFM_DIR = path.join(ROOT, 'vendor', 'dsh-our-free-model')
const OFM_SERVICE = path.join(OFM_DIR, 'packages', 'standalone', 'service.mjs')
const UPSTREAM_REPO = 'https://github.com/Ebony-Vinyl/dsh-our-free-model.git'

/**
 * 若本地尚无精简版 OurFreeModel 独立运行时，则自动从上游浅克隆并裁剪为约 5.8 MB 的纯运行时文件。
 */
export async function ensureVendorOfm(force = false) {
  if (!force && fs.existsSync(OFM_SERVICE)) {
    return
  }
  const cloneTmp = path.join(ROOT, 'vendor', '.ofm-clone-tmp')
  const stageTmp = path.join(ROOT, 'vendor', '.ofm-stage-tmp')
  fs.mkdirSync(path.join(ROOT, 'vendor'), { recursive: true })
  fs.rmSync(cloneTmp, { recursive: true, force: true })
  fs.rmSync(stageTmp, { recursive: true, force: true })

  try {
    console.log(`[sync-ofm] 正在拉取上游 OurFreeModel 运行时 (${UPSTREAM_REPO})...`)
    execFileSync('git', ['clone', '--depth', '1', UPSTREAM_REPO, cloneTmp], { stdio: 'inherit' })

    const packMod = await import(
      pathToFileURL(path.join(cloneTmp, 'scripts', 'pack-standalone.mjs')).href
    )
    const keepFiles = new Set([
      ...packMod.standaloneSourceFiles(),
      'scripts/pack-standalone.mjs',
      'LICENSE',
    ])

    fs.mkdirSync(stageTmp, { recursive: true })
    for (const rel of keepFiles) {
      const src = path.join(cloneTmp, rel)
      const dst = path.join(stageTmp, rel)
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
    }

    const standalonePkg = JSON.parse(
      fs.readFileSync(path.join(stageTmp, 'packages', 'standalone', 'package.json'), 'utf8')
    )
    fs.writeFileSync(
      path.join(stageTmp, 'package.json'),
      JSON.stringify(
        {
          name: standalonePkg.name || 'dsh-our-free-model',
          version: standalonePkg.version || '2.9.0',
          private: true,
          type: 'module',
          license: 'MIT',
        },
        null,
        2
      ) + '\n',
      'utf8'
    )

    fs.rmSync(OFM_DIR, { recursive: true, force: true })
    fs.renameSync(stageTmp, OFM_DIR)
    console.log(`[sync-ofm] 已完成 OurFreeModel v${standalonePkg.version} 精简运行时同步（${keepFiles.size + 1} 个文件）。`)
  } finally {
    fs.rmSync(cloneTmp, { recursive: true, force: true })
    fs.rmSync(stageTmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  ensureVendorOfm(process.argv.includes('--force')).catch((err) => {
    console.error('[sync-ofm] 同步失败：', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
