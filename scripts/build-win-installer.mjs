import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WIN_SRC = path.join(ROOT, 'scripts', 'win-installer')
const RELEASE_DIR = path.join(ROOT, 'release')
const STAGE_DIR = path.join(RELEASE_DIR, '.build-stage')
const PAYLOAD_DIR = path.join(STAGE_DIR, 'payload')
const PAYLOAD_ZIP = path.join(STAGE_DIR, 'payload.zip')
const ICON_PATH = path.join(STAGE_DIR, 'app.ico')

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const APP_VERSION = pkg.version || '0.1.4'
const OUTPUT_EXE = path.join(RELEASE_DIR, `DeepSeek-Persona-Setup-v${APP_VERSION}-win-x64.exe`)

const findCsc = () => {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  throw new Error('未找到 .NET Framework 4.x 编译器 csc.exe')
}

const copyRecursive = (src, dest) => {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

/** 用 Windows 内置 .NET System.Drawing 生成多分辨率深蓝极简 .ico 图标。 */
const generateAppIcon = (icoFile) => {
  const psScript = `
Add-Type -AssemblyName System.Drawing
function New-IconPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [int][Math]::Max(1, [Math]::Round($size * 0.06))
  $w = $size - $pad * 2
  $r = [int][Math]::Max(3, [Math]::Round($w * 0.24))

  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc($pad, $pad, $r * 2, $r * 2, 180, 90)
  $gp.AddArc($pad + $w - $r * 2, $pad, $r * 2, $r * 2, 270, 90)
  $gp.AddArc($pad + $w - $r * 2, $pad + $w - $r * 2, $r * 2, $r * 2, 0, 90)
  $gp.AddArc($pad, $pad + $w - $r * 2, $r * 2, $r * 2, 90, 90)
  $gp.CloseFigure()

  $rect = New-Object System.Drawing.Rectangle($pad, $pad, $w, $w)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 30, 42, 74),
    [System.Drawing.Color]::FromArgb(255, 77, 107, 254),
    45.0
  )
  $g.FillPath($brush, $gp)

  # 中心极简四角星辉 + 轨道环（象征人格与智能）
  $cx = $size / 2.0
  $cy = $size / 2.0
  $outer = $size * 0.30
  $inner = $size * 0.11
  $pts = New-Object 'System.Drawing.PointF[]' 8
  for ($i = 0; $i -lt 8; $i++) {
    $ang = ($i * 45.0 - 90.0) * [Math]::PI / 180.0
    $rad = if ($i % 2 -eq 0) { $outer } else { $inner }
    $pts[$i] = New-Object System.Drawing.PointF([float]($cx + $rad * [Math]::Cos($ang)), [float]($cy + $rad * [Math]::Sin($ang)))
  }
  $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPolygon($starBrush, $pts)

  $dotR = [float]($size * 0.055)
  $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 147, 197, 253))
  $g.FillEllipse($dotBrush, [float]($cx + $size * 0.18 - $dotR), [float]($cy - $size * 0.22 - $dotR), $dotR * 2, $dotR * 2)

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose(); $dotBrush.Dispose(); $starBrush.Dispose(); $brush.Dispose(); $gp.Dispose(); $g.Dispose(); $bmp.Dispose()
  return ,$bytes
}

$sizes = @(16, 32, 48, 256)
$pngs = @()
foreach ($s in $sizes) { $pngs += ,(New-IconPng $s) }

$fs = [System.IO.File]::Create('${icoFile.replace(/'/g, "''")}')
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR header
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)

$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]
  $data = $pngs[$i]
  $b = if ($sz -eq 256) { [Byte]0 } else { [Byte]$sz }
  $bw.Write($b)
  $bw.Write($b)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $bw.Write($pngs[$i])
}
$bw.Flush(); $bw.Dispose(); $fs.Dispose()
`
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
    stdio: 'inherit',
  })
}

const createZipFromDir = (sourceDir, zipFile) => {
  const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${zipFile.replace(/'/g, "''")}') { Remove-Item -Force '${zipFile.replace(/'/g, "''")}' }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  '${sourceDir.replace(/'/g, "''")}',
  '${zipFile.replace(/'/g, "''")}',
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
`
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    stdio: 'inherit',
  })
}

const main = async () => {
  const startTs = Date.now()
  const csc = findCsc()
  const nodeExe = process.execPath
  console.log(`[1/6] 环境检查通过：Node ${process.version} (${nodeExe})，CSC (${csc})`)

  // 1. 生产构建前端 dist/
  console.log('[2/6] 构建生产版前端静态资源（Rspack）...')
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Set-Location '${ROOT.replace(/'/g, "''")}'; $env:NODE_ENV='production'; pnpm exec rspack build -c rspack.config.ts`,
    ],
    { stdio: 'inherit' }
  )

  // 2. 清理并准备打包暂存目录
  fs.rmSync(STAGE_DIR, { recursive: true, force: true })
  fs.mkdirSync(PAYLOAD_DIR, { recursive: true })
  fs.mkdirSync(RELEASE_DIR, { recursive: true })

  // 3. 生成多分辨率图标
  console.log('[3/6] 生成应用图标与桌面托盘启动器 / 卸载器...')
  generateAppIcon(ICON_PATH)

  // 编译 DeepSeekPersona.exe（桌面托盘启动器）
  const launcherExe = path.join(PAYLOAD_DIR, 'DeepSeekPersona.exe')
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:anycpu',
      `/win32icon:${ICON_PATH}`,
      `/out:${launcherExe}`,
      '/reference:System.dll',
      '/reference:System.Drawing.dll',
      '/reference:System.Windows.Forms.dll',
      path.join(WIN_SRC, 'Launcher.cs'),
    ],
    { stdio: 'inherit' }
  )

  // 编译 Uninstall.exe（独立卸载器）
  const uninstallExe = path.join(PAYLOAD_DIR, 'Uninstall.exe')
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:anycpu',
      `/win32icon:${ICON_PATH}`,
      `/out:${uninstallExe}`,
      '/reference:System.dll',
      '/reference:System.Drawing.dll',
      '/reference:System.Windows.Forms.dll',
      path.join(WIN_SRC, 'Uninstaller.cs'),
    ],
    { stdio: 'inherit' }
  )

  // 4. 组装精简自包含运行时负载
  console.log('[4/6] 组装自包含运行时（私有 Node + 前端 dist + 内置 OurFreeModel 精简运行时）...')
  const runtimeDir = path.join(PAYLOAD_DIR, 'runtime')
  const appDir = path.join(PAYLOAD_DIR, 'app')
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.mkdirSync(appDir, { recursive: true })

  fs.copyFileSync(nodeExe, path.join(runtimeDir, 'node.exe'))
  const nodeLicense = path.join(path.dirname(nodeExe), 'LICENSE')
  if (fs.existsSync(nodeLicense)) {
    fs.copyFileSync(nodeLicense, path.join(runtimeDir, 'LICENSE'))
  }

  // 复制前端 dist/
  copyRecursive(path.join(ROOT, 'dist'), path.join(appDir, 'dist'))

  // 复制生产启动脚本
  fs.mkdirSync(path.join(appDir, 'scripts'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'scripts', 'start-app.mjs'), path.join(appDir, 'scripts', 'start-app.mjs'))
  fs.copyFileSync(path.join(ROOT, 'scripts', 'ofm-bridge.mjs'), path.join(appDir, 'scripts', 'ofm-bridge.mjs'))

  // 写入 app/package.json（确保 ESM）
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'deepseek-persona', version: APP_VERSION, private: true, type: 'module' }, null, 2) + '\n',
    'utf8'
  )
  if (fs.existsSync(path.join(ROOT, 'LICENSE'))) {
    fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(PAYLOAD_DIR, 'LICENSE'))
  }

  // 精确复制 OurFreeModel standalone 运行所需文件（仅 ~5.8 MB）
  const packMod = await import(
    pathToFileURL(path.join(ROOT, 'vendor', 'dsh-our-free-model', 'scripts', 'pack-standalone.mjs')).href
  )
  const ofmFiles = packMod.standaloneSourceFiles()
  const ofmDestRoot = path.join(appDir, 'vendor', 'dsh-our-free-model')
  for (const rel of ofmFiles) {
    const srcFile = path.join(packMod.repositoryRoot, rel)
    const dstFile = path.join(ofmDestRoot, rel)
    fs.mkdirSync(path.dirname(dstFile), { recursive: true })
    fs.copyFileSync(srcFile, dstFile)
  }
  const ofmStandalonePkg = JSON.parse(
    fs.readFileSync(path.join(ofmDestRoot, 'packages', 'standalone', 'package.json'), 'utf8')
  )
  fs.writeFileSync(
    path.join(ofmDestRoot, 'package.json'),
    JSON.stringify(
      {
        name: ofmStandalonePkg.name || 'dsh-our-free-model',
        version: ofmStandalonePkg.version || '2.9.0',
        private: true,
        type: 'module',
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  // 5. 压缩 payload.zip
  console.log('[5/6] 正在压缩安装包负载（Optimal 压缩）...')
  createZipFromDir(PAYLOAD_DIR, PAYLOAD_ZIP)
  const zipMb = (fs.statSync(PAYLOAD_ZIP).size / 1024 / 1024).toFixed(2)
  console.log(`      payload.zip 压缩完成：${zipMb} MB`)

  // 6. 将 payload.zip 嵌入为资源，编译单文件一键安装程序 .exe
  console.log('[6/6] 编译单文件 Windows 图形安装程序...')
  const setupSrcRaw = fs.readFileSync(path.join(WIN_SRC, 'Setup.cs'), 'utf8')
  const setupSrcVersioned = path.join(STAGE_DIR, 'Setup.g.cs')
  fs.writeFileSync(setupSrcVersioned, setupSrcRaw.replace(/__APP_VERSION__/g, APP_VERSION), 'utf8')

  if (fs.existsSync(OUTPUT_EXE)) {
    fs.rmSync(OUTPUT_EXE, { force: true })
  }

  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:x64',
      `/win32icon:${ICON_PATH}`,
      `/resource:${PAYLOAD_ZIP},payload.zip`,
      `/out:${OUTPUT_EXE}`,
      '/reference:System.dll',
      '/reference:System.Drawing.dll',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.IO.Compression.dll',
      '/reference:System.IO.Compression.FileSystem.dll',
      setupSrcVersioned,
    ],
    { stdio: 'inherit' }
  )

  // 清理暂存目录
  fs.rmSync(STAGE_DIR, { recursive: true, force: true })

  const exeMb = (fs.statSync(OUTPUT_EXE).size / 1024 / 1024).toFixed(2)
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
  console.log(`\n✅ Windows 一键安装包生成成功！`)
  console.log(`   文件位置：${OUTPUT_EXE}`)
  console.log(`   安装包大小：${exeMb} MB（内含完整私有 Node ${process.version} 运行时 + 前端 + OurFreeModel）`)
  console.log(`   耗时：${elapsed}s`)
}

main().catch((err) => {
  console.error('打包失败：', err)
  process.exit(1)
})
