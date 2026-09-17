/**
 * One-shot screen OCR for Dota pick-phase nicks (legal: screen pixels, not memory).
 * Captures 10 player slots separately (skips center timer) and filters medal junk.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TMP_DIR = path.join(os.tmpdir(), 'replayface-ocr')

const JUNK =
  /^(radiant|dire|тьма|свет|all|pick|all\s*pick|captains|strategy|ban|vs|enemy|ally|dota|valve|unranked|rank|medal|hero|select|стадия|выбора|планирования|выберите|ещё|еще|одного|двух|трёх|трех|героев|героя|лёгкая|легкая|сложная|поддержка|полный|центр|\d+:\d+)$/i

const MEDAL =
  /^(herald|guardian|crusader|archon|legend|ancient|divine|immortal|recruiter|божество|властелин|титан|древний|божественный|легенда|рыцарь|страж|рекрут|умелец|центурион)(\s*(i{1,3}|iv|v|\d+))?$/i

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

async function minimizeReplayFaceWindows() {
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RfWin {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'ReplayFace' } | ForEach-Object {
  [RfWin]::ShowWindowAsync($_.MainWindowHandle, 6) | Out-Null
}
Start-Sleep -Milliseconds 350
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
 * Capture top pick bar as 10 player-slot crops (5 left + 5 right, skip center timer).
 * Also saves a name-band strip for debug.
 */
export async function capturePickSlots({ heightPx = 130, scale = 4 } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('OCR screen capture сейчас только для Windows')
  }
  ensureTmp()
  const stamp = Date.now()
  const outDir = path.join(TMP_DIR, `slots-${stamp}`)
  fs.mkdirSync(outDir, { recursive: true })
  const bandPng = path.join(outDir, 'band.png')
  const safeDir = outDir.replace(/'/g, "''")
  const safeBand = bandPng.replace(/'/g, "''")

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.Width * $_.Bounds.Height } -Descending | Select-Object -First 1
$b = $screen.Bounds
$sw = [int]$b.Width
$sh = [int]$b.Height

$targetAspect = 16.0 / 9.0
$gameW = $sw
$gameX = 0
if (($sw * 1.0 / [Math]::Max(1,$sh)) -gt 1.9) {
  $gameW = [Math]::Min($sw, [int]($sh * $targetAspect))
  $gameX = [int](($sw - $gameW) / 2)
}

$h = [Math]::Min([Math]::Max(90, ${Number(heightPx)}), [int]($sh * 0.2))
# Name text sits in lower part of the top player panel — skip medal badge tops a bit
$y0 = [Math]::Max(0, [int]($h * 0.08))
$h2 = $h - $y0

$src = New-Object System.Drawing.Bitmap $gameW, $h2
$g = [System.Drawing.Graphics]::FromImage($src)
$g.CopyFromScreen(($b.X + $gameX), ($b.Y + $y0), 0, 0, (New-Object System.Drawing.Size $gameW, $h2))
$g.Dispose()

function Upscale([System.Drawing.Bitmap]$srcBmp, [int]$scale) {
  $dw = [Math]::Max(1, $srcBmp.Width * $scale)
  $dh = [Math]::Max(1, $srcBmp.Height * $scale)
  $dst = New-Object System.Drawing.Bitmap $dw, $dh
  $gg = [System.Drawing.Graphics]::FromImage($dst)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $gg.DrawImage($srcBmp, 0, 0, $dw, $dh)
  $gg.Dispose()
  return $dst
}

$scale = ${Number(scale)}
$band = Upscale $src $scale
$band.Save('${safeBand}', [System.Drawing.Imaging.ImageFormat]::Png)
$band.Dispose()

# Skip center timer (~18% width). Split sides into 5 slots each.
$midSkip = [int]($src.Width * 0.18)
$sideW = [int](($src.Width - $midSkip) / 2)
$leftX = 0
$rightX = $sideW + $midSkip
$slotW = [Math]::Max(20, [int]($sideW / 5))

$paths = @()
for ($i = 0; $i -lt 5; $i++) {
  $x = $leftX + ($i * $slotW)
  $w = if ($i -eq 4) { $sideW - ($i * $slotW) } else { $slotW }
  $rect = New-Object System.Drawing.Rectangle $x, 0, $w, $src.Height
  $crop = $src.Clone($rect, $src.PixelFormat)
  $up = Upscale $crop $scale
  $p = Join-Path '${safeDir}' ("slot-R$i.png")
  $up.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $paths += $p
  $up.Dispose(); $crop.Dispose()
}
for ($i = 0; $i -lt 5; $i++) {
  $x = $rightX + ($i * $slotW)
  $w = if ($i -eq 4) { ($src.Width - $rightX) - ($i * $slotW) } else { $slotW }
  if ($w -lt 10) { continue }
  $rect = New-Object System.Drawing.Rectangle $x, 0, $w, $src.Height
  $crop = $src.Clone($rect, $src.PixelFormat)
  $up = Upscale $crop $scale
  $p = Join-Path '${safeDir}' ("slot-D$i.png")
  $up.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $paths += $p
  $up.Dispose(); $crop.Dispose()
}

$src.Dispose()
Write-Output ("ok gameW=$gameW h=$h2 scale=$scale slots=" + $paths.Count + " screen=$sw" + "x$sh")
`
  const script = path.join(TMP_DIR, 'capture-slots.ps1')
  fs.writeFileSync(script, ps, 'utf8')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    90000,
  )
  const slots = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith('slot-') && f.endsWith('.png'))
    .sort()
    .map((f) => path.join(outDir, f))
  if (!slots.length) throw new Error('Slot capture failed')
  return { band: bandPng, slots, meta: String(stdout || '').trim(), outDir }
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
  const script = path.join(TMP_DIR, `ocr-win-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`)
  fs.writeFileSync(script, ps, 'utf8')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    20000,
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
  const result = await Tesseract.recognize(pngPath, 'eng', {
    logger: () => {},
    tessedit_pageseg_mode: '7', // treat as single text line — better for slot nicks
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

function isMedalJunk(t) {
  if (MEDAL.test(t) || ROLE.test(t) || JUNK.test(t)) return true
  if (/^[\d\sIVXivx.]+$/.test(t)) return true // 102, IV, 86 V
  if (/^[IVX]+$/i.test(t)) return true
  if (/^\d{1,4}$/.test(t)) return true
  // mostly rank numerals with a stray ALL/PICK word
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const junkWords = words.filter((w) => /^[\dIVX]+$/i.test(w) || JUNK.test(w) || MEDAL.test(w))
    if (junkWords.length / words.length >= 0.6) return true
  }
  return false
}

function scoreNickCandidate(t) {
  let s = 0
  if (/[a-z]/.test(t)) s += 3 // real nicks often have lowercase
  if (/[A-Z]/.test(t) && /[a-z]/.test(t)) s += 2
  if (/[\p{L}]/u.test(t) && t.length >= 3) s += 2
  if (/[_\-.]/.test(t)) s += 1
  if (/\s/.test(t) && t.split(/\s+/).length <= 3) s += 1 // sugar coma
  if (isMedalJunk(t)) s -= 20
  if (t.length < 2) s -= 10
  return s
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
    if (isMedalJunk(t)) return
    if (!/[\p{L}]/u.test(t)) return
    // need at least one "real" letter that isn't only roman-numeral-ish single I/V
    if (/^[iv]+$/i.test(t)) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    tokens.push(t)
  }

  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/\s{2,}/g, ' ').trim()
    if (!cleaned) continue
    push(cleaned)
    for (const part of cleaned.split(/\s{2,}/)) push(part)
    const words = cleaned.split(/\s+/).filter(Boolean)
    if (words.length === 1) push(words[0])
    if (words.length === 2) {
      push(words[0])
      push(`${words[0]} ${words[1]}`)
    }
    if (words.length >= 3) {
      // take first non-junk word as nick
      for (const w of words) {
        if (!isMedalJunk(w) && /[\p{L}]/u.test(w) && w.length >= 2) {
          push(w)
          break
        }
      }
    }
  }

  return tokens
    .map((t) => ({ t, s: scoreNickCandidate(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t)
}

/** Best single nick from one slot's OCR text. */
export function bestNickFromSlotText(text) {
  const cands = parseNicksFromOcrText(text)
  return cands[0] || null
}

export async function scanPickNicks(opts = {}) {
  const delayMs = Math.min(5000, Math.max(0, Number(opts.delayMs) || 1200))
  ensureTmp()
  await minimizeReplayFaceWindows()
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs))

  const shots = await capturePickSlots({
    heightPx: Number(opts.heightPx) || 130,
    scale: Number(opts.scale) || 4,
  })

  const nicks = []
  const seen = new Set()
  const rawParts = []
  const engines = []
  const errors = []
  const perSlot = []

  // Parallel OCR (batches) — sequential 10× Windows OCR was too slow / empty
  const concurrency = 4
  for (let i = 0; i < shots.slots.length; i += concurrency) {
    const batch = shots.slots.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (file) => {
        const one = await ocrOne(file)
        return { file, one }
      }),
    )
    for (const { file, one } of results) {
      engines.push(one.engine)
      if (one.text) rawParts.push(one.text)
      if (one.errors?.length) errors.push(...one.errors)
      const nick = bestNickFromSlotText(one.text)
      const label = path.basename(file)
      perSlot.push({ slot: label, raw: (one.text || '').slice(0, 80), nick })
      if (nick) {
        const key = nick.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          nicks.push(nick)
        }
      }
    }
  }

  if (nicks.length < 2 && shots.band && fs.existsSync(shots.band)) {
    const band = await ocrOne(shots.band)
    if (band.text) {
      rawParts.push(`[band] ${band.text}`)
      for (const n of parseNicksFromOcrText(band.text)) {
        const key = n.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          nicks.push(n)
        }
      }
    }
  }

  // Loose fallback from raw: keep lines that look vaguely like nicks
  if (nicks.length === 0 && rawParts.length) {
    for (const line of rawParts.join('\n').split(/\r?\n/)) {
      const t = line
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[^\p{L}\p{N}_\-. ]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (t.length < 3 || t.length > 28) continue
      if (isMedalJunk(t)) continue
      if (!/[a-zA-Zа-яА-ЯёЁ]/.test(t)) continue
      if (/^[\d\sIVXivx]+$/.test(t)) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      nicks.push(t)
    }
  }

  return {
    ok: true,
    engine: [...new Set(engines.filter((e) => e && e !== 'none'))].join(',') || 'none',
    pngPath: shots.band,
    meta: shots.meta,
    rawText: rawParts.join('\n').slice(0, 2500),
    perSlot,
    errors: errors.slice(0, 8),
    nicks: nicks.slice(0, 12),
    hint:
      nicks.length === 0
        ? 'Ники не найдены. Вставь вручную с верхней панели (враги слева/справа от тебя).'
        : 'Проверь ники — OCR ошибается. Убери лишнее и жми Load intel.',
  }
}

void __dirname
