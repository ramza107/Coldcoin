/**
 * One-shot screen OCR for Dota pick-phase nicks (legal: reads pixels, not process memory).
 * Windows: GDI screenshot + Windows.Media.Ocr, optional tesseract.js fallback.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TMP_DIR = path.join(os.tmpdir(), 'replayface-ocr')

const JUNK =
  /^(radiant|dire|тьма|свет|all\s*pick|captains|strategy|ban|pick|vs|enemy|ally|dota|valve|unranked|rank|medal|hero|select|стадия|выбора|планирования|\d+:\d+|^\d+$)$/i

const MEDAL =
  /^(herald|guardian|crusader|archon|legend|ancient|divine|immortal|recruiter|титан|древний|божественный|властелин|легенда|рыцарь|страж|рекрут)(\s+(i{1,3}|iv|v|\d))?$/i

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

/** Capture top strip of primary monitor (draft name bar). */
export async function capturePickStrip({ heightRatio = 0.16 } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('OCR screen capture сейчас только для Windows')
  }
  ensureTmp()
  const outPng = path.join(TMP_DIR, `pick-${Date.now()}.png`)
  const safe = outPng.replace(/'/g, "''")
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$w = [int]$b.Width
$h = [Math]::Max(80, [int]($b.Height * ${Number(heightRatio)}))
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()
$bmp.Save('${safe}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "ok $w $h"
`
  const script = path.join(TMP_DIR, 'capture.ps1')
  fs.writeFileSync(script, ps, 'utf8')
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], 20000)
  if (!fs.existsSync(outPng)) throw new Error('Screenshot failed')
  return outPng
}

async function ocrWindowsMedia(pngPath) {
  const safe = pngPath.replace(/'/g, "''")
  // Standard WinRT AsTask bridge for Windows.Media.Ocr
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
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
if (-not $engine) { throw 'Windows OCR engine unavailable' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
Write-Output $result.Text
`
  const script = path.join(TMP_DIR, 'ocr-win.ps1')
  fs.writeFileSync(script, ps, 'utf8')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    60000,
  )
  return String(stdout || '').trim()
}

async function ocrTesseractJs(pngPath) {
  let Tesseract
  try {
    Tesseract = (await import('tesseract.js')).default
  } catch {
    throw new Error('tesseract.js не установлен')
  }
  const result = await Tesseract.recognize(pngPath, 'eng', { logger: () => {} })
  return String(result?.data?.text || '').trim()
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
      .replace(/\.{2,}$/g, '')
      .replace(/[^\p{L}\p{N}_\-. ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length < 2 || t.length > 32) return
    if (JUNK.test(t) || MEDAL.test(t)) return
    if (/^\d+(\.\d+)?$/.test(t)) return
    if (/^(I|II|III|IV|V)$/i.test(t)) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    tokens.push(t)
  }

  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/\s{2,}/g, ' ').trim()
    if (!cleaned) continue
    if (cleaned.length <= 28 && /[\p{L}]/u.test(cleaned)) push(cleaned)
    for (const part of cleaned.split(/\s{2,}|\s[·•]\s|\s-\s/)) push(part)
  }

  return tokens.filter((t) => /[\p{L}]/u.test(t)).slice(0, 12)
}

export async function scanPickNicks(opts = {}) {
  const delayMs = Math.min(5000, Math.max(0, Number(opts.delayMs) || 2000))
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs))

  const pngPath = await capturePickStrip({ heightRatio: opts.heightRatio || 0.16 })
  let engine = 'windows'
  let text = ''
  try {
    text = await ocrWindowsMedia(pngPath)
  } catch (winErr) {
    try {
      engine = 'tesseract.js'
      text = await ocrTesseractJs(pngPath)
    } catch (tessErr) {
      throw new Error(
        `OCR недоступен. Windows: ${winErr instanceof Error ? winErr.message : winErr}; tesseract: ${tessErr instanceof Error ? tessErr.message : tessErr}`,
      )
    }
  }

  const nicks = parseNicksFromOcrText(text)
  return {
    ok: true,
    engine,
    pngPath,
    rawText: text.slice(0, 2000),
    nicks,
    hint:
      nicks.length === 0
        ? 'Ничего не распознано. Разверни Dota на основной монитор на весь экран, стадия пика, нажми снова.'
        : 'Проверь ники — OCR ошибается. Убери лишнее и жми поиск.',
  }
}

void __dirname
