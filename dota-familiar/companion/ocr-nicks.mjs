/**
 * One-shot screen OCR for Dota pick-phase nicks (legal: screen pixels, not memory).
 * Tuned for ultrawide + small white names on dark top bar.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TMP_DIR = path.join(os.tmpdir(), 'replayface-ocr')

const JUNK =
  /^(radiant|dire|тьма|свет|all\s*pick|captains|strategy|ban|pick|vs|enemy|ally|dota|valve|unranked|rank|medal|hero|select|стадия|выбора|планирования|выберите|ещё|одного|героя|лёгкая|легкая|сложная|поддержка|полный|центр|\d+:\d+|^\d+$)$/i

const MEDAL =
  /^(herald|guardian|crusader|archon|legend|ancient|divine|immortal|recruiter|титан|древний|божественный|властелин|легенда|рыцарь|страж|рекрут)(\s+(i{1,3}|iv|v|\d))?$/i

const ROLE =
  /^(mid|carry|off|support|hard|soft|pos\s*[1-5]|лёгкая|легкая|сложная|поддержка|полный\s*саппорт|центр)$/i

function run(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      reject(new Error(`${cmd} timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(stderr.trim() || `${cmd} exit ${code}`))
      else resolve({ stdout, stderr })
    })
  })
}

function ensureTmp() {
  fs.mkdirSync(TMP_DIR, { recursive: true })
}

/** Minimize ReplayFace so it does not cover the draft name bar. */
async function minimizeReplayFaceWindows() {
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RfWin {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'ReplayFace' } | ForEach-Object {
  [RfWin]::ShowWindowAsync($_.MainWindowHandle, 6) | Out-Null
}
Start-Sleep -Milliseconds 400
Write-Output 'minimized'
`
  const script = path.join(TMP_DIR, 'minimize.ps1')
  fs.writeFileSync(script, ps, 'utf8')
  try {
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], 8000)
  } catch {
    // non-fatal
  }
}

/**
 * Capture top name bar. On ultrawide, crop to centered ~16:9 game area
 * and upscale + boost contrast for small white text.
 */
export async function capturePickStrip({ heightPx = 110, scale = 3 } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('OCR screen capture сейчас только для Windows')
  }
  ensureTmp()
  const stamp = Date.now()
  const outPng = path.join(TMP_DIR, `pick-${stamp}.png`)
  const leftPng = path.join(TMP_DIR, `pick-L-${stamp}.png`)
  const rightPng = path.join(TMP_DIR, `pick-R-${stamp}.png`)
  const safeOut = outPng.replace(/'/g, "''")
  const safeL = leftPng.replace(/'/g, "''")
  const safeR = rightPng.replace(/'/g, "''")

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Prefer the largest screen (often ultrawide with Dota)
$screen = [System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.Width * $_.Bounds.Height } -Descending | Select-Object -First 1
$b = $screen.Bounds
$sw = [int]$b.Width
$sh = [int]$b.Height

# Dota HUD on ultrawide sits in a centered 16:9-ish band
$targetAspect = 16.0 / 9.0
$gameW = $sw
$gameX = 0
if (($sw * 1.0 / [Math]::Max(1,$sh)) -gt 1.9) {
  $gameW = [Math]::Min($sw, [int]($sh * $targetAspect))
  $gameX = [int](($sw - $gameW) / 2)
}

$h = [Math]::Min([Math]::Max(70, ${Number(heightPx)}), [int]($sh * 0.18))
$src = New-Object System.Drawing.Bitmap $gameW, $h
$g = [System.Drawing.Graphics]::FromImage($src)
$g.CopyFromScreen(($b.X + $gameX), $b.Y, 0, 0, (New-Object System.Drawing.Size $gameW, $h))
$g.Dispose()

function Enhance([System.Drawing.Bitmap]$srcBmp, [int]$scale) {
  $dw = [Math]::Max(1, $srcBmp.Width * $scale)
  $dh = [Math]::Max(1, $srcBmp.Height * $scale)
  $dst = New-Object System.Drawing.Bitmap $dw, $dh
  $gg = [System.Drawing.Graphics]::FromImage($dst)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $gg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
  $gg.DrawImage($srcBmp, 0, 0, $dw, $dh)
  $gg.Dispose()
  return $dst
}

$scale = ${Number(scale)}
$full = Enhance $src $scale
$full.Save('${safeOut}', [System.Drawing.Imaging.ImageFormat]::Png)

$half = [int]($src.Width / 2)
$rectL = New-Object System.Drawing.Rectangle 0, 0, $half, $src.Height
$rectR = New-Object System.Drawing.Rectangle $half, 0, ($src.Width - $half), $src.Height
$leftSrc = $src.Clone($rectL, $src.PixelFormat)
$rightSrc = $src.Clone($rectR, $src.PixelFormat)
$left = Enhance $leftSrc $scale
$right = Enhance $rightSrc $scale
$left.Save('${safeL}', [System.Drawing.Imaging.ImageFormat]::Png)
$right.Save('${safeR}', [System.Drawing.Imaging.ImageFormat]::Png)

$left.Dispose(); $right.Dispose(); $leftSrc.Dispose(); $rightSrc.Dispose()
$full.Dispose(); $src.Dispose()
Write-Output "ok gameW=$gameW h=$h scale=$scale screen=$sw x$sh"
`
  const script = path.join(TMP_DIR, 'capture.ps1')
  fs.writeFileSync(script, ps, 'utf8')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    90000,
  )
  if (!fs.existsSync(outPng)) throw new Error('Screenshot failed')
  return { full: outPng, left: leftPng, right: rightPng, meta: String(stdout || '').trim() }
}

async function ocrWindowsMedia(pngPath) {
  const safe = pngPath.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
if (-not $asTaskGeneric) { throw 'AsTask bridge missing' }
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${safe}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US'))
}
if (-not $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ru'))
}
if (-not $engine) { throw 'Windows OCR engine unavailable' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
Write-Output $result.Text
`
  const script = path.join(TMP_DIR, `ocr-win-${Date.now()}.ps1`)
  fs.writeFileSync(script, ps, 'utf8')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    90000,
  )
  return String(stdout || '').trim()
}

async function ocrTesseractJs(pngPath) {
  let Tesseract
  try {
    Tesseract = (await import('tesseract.js')).default
  } catch {
    throw new Error('tesseract.js не установлен — запусти ReplayFace.bat ещё раз (npm install)')
  }
  const result = await Tesseract.recognize(pngPath, 'eng', {
    logger: () => {},
    tessedit_pageseg_mode: '6',
  })
  return String(result?.data?.text || '').trim()
}

async function ocrOne(pngPath) {
  const errors = []
  try {
    const text = await ocrWindowsMedia(pngPath)
    if (text) return { engine: 'windows', text }
    errors.push('windows: empty')
  } catch (e) {
    errors.push(`windows: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const text = await ocrTesseractJs(pngPath)
    if (text) return { engine: 'tesseract.js', text }
    errors.push('tesseract: empty')
  } catch (e) {
    errors.push(`tesseract: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { engine: 'none', text: '', errors }
}

export function parseNicksFromOcrText(text) {
  const raw = String(text || '')
    .replace(/\u2026/g, '...')
    .replace(/[|]/g, ' ')
  const tokens = []
  const seen = new Set()

  const push = (s) => {
    let t = String(s || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\.{2,}$/g, '')
      .replace(/[^\p{L}\p{N}_\-. ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 2 || t.length > 32) return
    if (JUNK.test(t) || MEDAL.test(t) || ROLE.test(t)) return
    if (/^\d+(\.\d+)?$/.test(t)) return
    if (/^(I|II|III|IV|V)$/i.test(t)) return
    // drop single-letter noise
    if (t.length < 3 && !/[0-9]/.test(t)) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    tokens.push(t)
  }

  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/\s{2,}/g, ' ').trim()
    if (!cleaned) continue
    if (cleaned.length <= 28 && /[\p{L}]/u.test(cleaned)) push(cleaned)
    // also split on spaces for "Name Role" OCR lines
    for (const part of cleaned.split(/\s{2,}|\s[·•]\s/)) push(part)
    const words = cleaned.split(/\s+/)
    if (words.length >= 2 && words.length <= 4) {
      // try first word as nick (Rayees[tag] already stripped)
      push(words[0])
      // two-word nick: sugar coma
      if (words.length >= 2) push(`${words[0]} ${words[1]}`)
    }
  }

  return tokens.filter((t) => /[\p{L}]/u.test(t)).slice(0, 14)
}

export async function scanPickNicks(opts = {}) {
  const delayMs = Math.min(5000, Math.max(0, Number(opts.delayMs) || 1500))
  ensureTmp()
  await minimizeReplayFaceWindows()
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs))

  const shots = await capturePickStrip({
    heightPx: Number(opts.heightPx) || 120,
    scale: Number(opts.scale) || 3,
  })

  const parts = []
  const engines = []
  const errors = []
  for (const [label, file] of [
    ['full', shots.full],
    ['left', shots.left],
    ['right', shots.right],
  ]) {
    if (!file || !fs.existsSync(file)) continue
    const one = await ocrOne(file)
    engines.push(`${label}:${one.engine}`)
    if (one.text) parts.push(one.text)
    if (one.errors?.length) errors.push(...one.errors.map((e) => `${label}/${e}`))
  }

  const text = parts.join('\n')
  const nicks = parseNicksFromOcrText(text)
  const engine = engines.join(',') || 'none'

  return {
    ok: true,
    engine,
    pngPath: shots.full,
    meta: shots.meta,
    rawText: text.slice(0, 2500),
    errors: errors.slice(0, 8),
    nicks,
    hint:
      nicks.length === 0
        ? `Ничего не распознано (${engine}). Окно свернётся само — Dota на большой монитор, пик, полный экран. Сырой OCR ниже / в статусе.`
        : 'Проверь ники — OCR ошибается. Убери лишнее и жми Load intel.',
  }
}

void __dirname
