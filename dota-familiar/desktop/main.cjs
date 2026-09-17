/**
 * ReplayFace Desktop — одно окно, без Overwolf.
 * Поднимает companion внутри процесса через Node child.
 */
const { app, BrowserWindow, shell, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execFileSync } = require('child_process')
const http = require('http')

const PORT = 17321
const ROOT = path.join(__dirname, '..')
let companionProc = null
let mainWindow = null

function findNode() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where', ['node'], { encoding: 'utf8' })
      const line = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      if (line) return line
    } else {
      const out = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
      if (out) return out
    }
  } catch {
    // fall through
  }
  return 'node'
}

function waitForHealth(timeoutMs = 25000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve(true)
        else retry()
      })
      req.on('error', retry)
      req.setTimeout(1500, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) reject(new Error('Companion did not start in time'))
      else setTimeout(tick, 400)
    }
    tick()
  })
}

function startCompanion() {
  const script = path.join(ROOT, 'companion', 'server.mjs')
  if (!fs.existsSync(script)) throw new Error(`Missing ${script}`)
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('Missing dist/ — run npm run build once')
  }
  const node = findNode()
  companionProc = spawn(node, [script], {
    cwd: ROOT,
    env: { ...process.env, RF_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  companionProc.stdout.on('data', (d) => console.log('[companion]', d.toString().trim()))
  companionProc.stderr.on('data', (d) => console.error('[companion]', d.toString().trim()))
  companionProc.on('exit', (code) => {
    console.log('[companion] exit', code)
    companionProc = null
  })
}

function stopCompanion() {
  if (companionProc && !companionProc.killed) {
    try {
      companionProc.kill()
    } catch {
      // ignore
    }
    companionProc = null
  }
}

function installGsi() {
  const cfgSrc = path.join(ROOT, 'companion', 'gamestate_integration_replayface.cfg')
  if (!fs.existsSync(cfgSrc)) {
    dialog.showErrorBox('GSI', 'Config missing')
    return
  }
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Steam', 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'cfg'),
    path.join(process.env.ProgramFiles || '', 'Steam', 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'cfg'),
  ]
  let destRoot = candidates.find((p) => p && fs.existsSync(p))
  if (!destRoot) {
    const picked = dialog.showOpenDialogSync(mainWindow, {
      title: 'Select Dota cfg folder (…/game/dota/cfg)',
      properties: ['openDirectory'],
    })
    if (!picked?.[0]) return
    destRoot = picked[0]
  }
  const gsiDir = path.join(destRoot, 'gamestate_integration')
  fs.mkdirSync(gsiDir, { recursive: true })
  const dest = path.join(gsiDir, 'gamestate_integration_replayface.cfg')
  fs.copyFileSync(cfgSrc, dest)
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'GSI installed',
    message: `Saved:\n${dest}\n\nSteam → Dota → Launch Options:\n-gamestateintegration\n\nRestart Dota.`,
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'ReplayFace',
    backgroundColor: '#0c1014',
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'ReplayFace',
        submenu: [
          { label: 'Install Dota GSI (optional)', click: () => installGsi() },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
    ]),
  )
}

app.whenReady().then(async () => {
  try {
    startCompanion()
    await waitForHealth()
    buildMenu()
    createWindow()
  } catch (e) {
    dialog.showErrorBox(
      'ReplayFace',
      `${e.message}\n\nНужен Node.js LTS в PATH (nodejs.org).\nЗакрой другие окна ReplayFace.`,
    )
    stopCompanion()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  stopCompanion()
  app.quit()
})
app.on('before-quit', () => stopCompanion())
