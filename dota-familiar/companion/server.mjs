#!/usr/bin/env node
/**
 * ReplayFace live lobby companion
 *
 * Listens on http://127.0.0.1:17321
 * - GET  /health          → ok
 * - GET  /lobby           → current lobby (for the web app)
 * - POST /lobby           → push Overwolf / manual roster JSON
 * - DELETE /lobby         → clear
 * - POST /gsi             → Dota Game State Integration (match start signal)
 * - GET  /              → tiny status page
 *
 * Valve hides enemy Steam IDs in raw GSI. After pick phase, Overwolf GEP
 * (or a manual paste) should POST /lobby with the roster.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.RF_PORT || 17321)
const HOST = process.env.RF_HOST || '127.0.0.1'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOBBY_FILE = path.join(__dirname, 'live-lobby.json')

/** @type {import('../src/types').LiveLobby | null} */
let lobby = null
let lastGsiAt = 0
let lastGsiState = ''
let matchStartedAt = null

const STEAM64_BASE = 76561197960265728n

function steamToAccountId(steam) {
  if (steam == null || steam === '') return null
  const s = String(steam).trim()
  if (/^\d{17}$/.test(s)) return Number(BigInt(s) - STEAM64_BASE)
  if (/^\d{3,12}$/.test(s)) return Number(s)
  return null
}

function cors(res, req) {
  const origin = req.headers.origin || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function sendJson(res, req, status, body) {
  cors(res, req)
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(null)
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function normalizePlayer(raw, fallbackTeam) {
  const accountId =
    steamToAccountId(raw.steamId ?? raw.steamid ?? raw.steam_id) ??
    (raw.accountId != null ? Number(raw.accountId) : raw.account_id != null ? Number(raw.account_id) : null)

  const teamRaw = String(raw.team ?? raw.team_name ?? fallbackTeam ?? '').toLowerCase()
  let team = null
  if (teamRaw.includes('radiant') || teamRaw === '2' || teamRaw === 'team2') team = 'radiant'
  if (teamRaw.includes('dire') || teamRaw === '3' || teamRaw === 'team3') team = 'dire'
  if (raw.isRadiant === true) team = 'radiant'
  if (raw.isRadiant === false) team = 'dire'

  const heroId = Number(raw.heroId ?? raw.hero_id ?? raw.hero ?? 0) || 0
  const personaname = raw.personaname || raw.name || raw.playerName || undefined

  if (!accountId && !personaname && !heroId) return null
  return {
    accountId: accountId && Number.isFinite(accountId) ? accountId : null,
    personaname,
    heroId,
    team: team || 'radiant',
    steamId: raw.steamId ?? raw.steamid ?? undefined,
    isOwner: Boolean(raw.isOwner || raw.is_local || raw.isLocal),
  }
}

/**
 * Accept several shapes:
 * { players: [...] }
 * { roster: { "0": {...}, ... } }  // Overwolf-style
 * { enemies: [...], allies: [...], myTeam: "radiant" }
 * [ ...players ]
 */
function normalizeLobby(input, source) {
  if (!input) return null
  const now = Date.now()
  let players = []
  let myTeam = input.myTeam || input.team || null
  let matchId = input.matchId ?? input.match_id ?? null

  if (Array.isArray(input)) {
    players = input.map((p) => normalizePlayer(p)).filter(Boolean)
  } else if (Array.isArray(input.players)) {
    players = input.players.map((p) => normalizePlayer(p)).filter(Boolean)
    myTeam = myTeam || input.myTeam || null
  } else if (input.roster && typeof input.roster === 'object') {
    players = Object.values(input.roster)
      .map((p) => normalizePlayer(p))
      .filter(Boolean)
  } else if (input.enemies || input.allies) {
    const enemies = (input.enemies || []).map((p) =>
      normalizePlayer({ ...p, team: flipTeam(input.myTeam || 'radiant') }),
    )
    const allies = (input.allies || []).map((p) =>
      normalizePlayer({ ...p, team: input.myTeam || 'radiant' }),
    )
    players = [...allies, ...enemies].filter(Boolean)
    myTeam = input.myTeam || 'radiant'
  }

  if (!players.length) return null

  if (!myTeam) {
    const owner = players.find((p) => p.isOwner)
    myTeam = owner?.team || players[0]?.team || 'radiant'
  }

  // Mark owner if provided
  const ownerAccountId =
    input.ownerAccountId ??
    input.owner_account_id ??
    steamToAccountId(input.ownerSteamId ?? input.owner_steamid)
  if (ownerAccountId) {
    players = players.map((p) => ({
      ...p,
      isOwner: p.accountId === ownerAccountId,
    }))
    const me = players.find((p) => p.isOwner)
    if (me) myTeam = me.team
  }

  const enemies = players.filter((p) => p.team !== myTeam && !p.isOwner)
  const allies = players.filter((p) => p.team === myTeam)

  return {
    source: source || input.source || 'manual',
    updatedAt: now,
    matchStartedAt: input.matchStartedAt || matchStartedAt || now,
    matchId: matchId != null ? Number(matchId) : null,
    gameState: input.gameState || lastGsiState || null,
    myTeam,
    players,
    enemies,
    allies,
  }
}

function flipTeam(team) {
  return team === 'radiant' ? 'dire' : 'radiant'
}

function persistLobby() {
  try {
    fs.writeFileSync(LOBBY_FILE, JSON.stringify(lobby, null, 2))
  } catch {
    // ignore
  }
}

function loadLobbyFile() {
  try {
    if (!fs.existsSync(LOBBY_FILE)) return
    const raw = JSON.parse(fs.readFileSync(LOBBY_FILE, 'utf8'))
    lobby = normalizeLobby(raw, raw.source || 'file')
  } catch {
    // ignore
  }
}

function handleGsi(body) {
  lastGsiAt = Date.now()
  const map = body?.map || {}
  const state = map.game_state || body?.player?.activity || ''
  lastGsiState = String(state)

  const started =
    /PRE_GAME|GAME_IN_PROGRESS|POST_GAME|STRATEGY_TIME|TEAM_SHOWCASE/i.test(lastGsiState) ||
    map.clock_time != null

  if (started && !matchStartedAt) {
    matchStartedAt = Date.now()
  }

  // Local player from GSI (enemy Steam IDs are usually absent)
  const localSteam = body?.player?.steamid
  const localName = body?.player?.name
  const localTeam = body?.player?.team_name
  const heroId = body?.hero?.id

  const allplayers = body?.allplayers
  if (allplayers && typeof allplayers === 'object') {
    const players = Object.values(allplayers).map((p) =>
      normalizePlayer({
        steamid: p.steamid,
        name: p.name,
        team_name: p.team_name,
        hero: p.heroid ?? p.hero?.id,
      }),
    )
    const normalized = normalizeLobby(
      {
        players,
        myTeam: localTeam,
        ownerSteamId: localSteam,
        matchId: map.matchid,
        gameState: lastGsiState,
        source: 'gsi',
      },
      'gsi',
    )
    if (normalized && normalized.players.filter((p) => p.accountId).length >= 2) {
      lobby = normalized
      persistLobby()
      return { ok: true, players: normalized.players.length, source: 'gsi-allplayers' }
    }
  }

  // Keep a stub lobby so the web UI knows a match is live even without roster
  if (started) {
    const stubPlayers = []
    const me = normalizePlayer({
      steamid: localSteam,
      name: localName,
      team_name: localTeam,
      hero: heroId,
      isOwner: true,
    })
    if (me) {
      me.isOwner = true
      stubPlayers.push(me)
    }
    if (!lobby || lobby.players.length < 2) {
      lobby = {
        source: 'gsi',
        updatedAt: Date.now(),
        matchStartedAt: matchStartedAt || Date.now(),
        matchId: map.matchid != null ? Number(map.matchid) : null,
        gameState: lastGsiState,
        myTeam: localTeam?.toLowerCase()?.includes('dire') ? 'dire' : 'radiant',
        players: stubPlayers,
        enemies: [],
        allies: stubPlayers,
        awaitingRoster: true,
      }
      persistLobby()
    } else {
      lobby = {
        ...lobby,
        gameState: lastGsiState,
        matchId: map.matchid != null ? Number(map.matchid) : lobby.matchId,
        updatedAt: Date.now(),
      }
    }
  }

  if (/POST_GAME|DOTA_GAMERULES_STATE_POST_GAME/i.test(lastGsiState)) {
    // keep lobby briefly for review; clear after idle
  }

  return { ok: true, gameState: lastGsiState, awaitingRoster: Boolean(lobby?.awaitingRoster) }
}

loadLobbyFile()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  const method = req.method || 'GET'

  if (method === 'OPTIONS') {
    cors(res, req)
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, req, 200, {
        ok: true,
        lobby: Boolean(lobby),
        lastGsiAt,
        gameState: lastGsiState || null,
      })
      return
    }

    if (method === 'GET' && url.pathname === '/lobby') {
      sendJson(res, req, 200, {
        lobby,
        companion: true,
        lastGsiAt: lastGsiAt || null,
        gameState: lastGsiState || null,
      })
      return
    }

    if (method === 'DELETE' && url.pathname === '/lobby') {
      lobby = null
      matchStartedAt = null
      try {
        fs.unlinkSync(LOBBY_FILE)
      } catch {
        // ignore
      }
      sendJson(res, req, 200, { ok: true })
      return
    }

    if (method === 'POST' && url.pathname === '/lobby') {
      const body = await readBody(req)
      const next = normalizeLobby(body, body?.source || 'overwolf')
      if (!next) {
        sendJson(res, req, 400, { error: 'Need players / roster / enemies' })
        return
      }
      next.awaitingRoster = false
      lobby = next
      matchStartedAt = next.matchStartedAt
      persistLobby()
      sendJson(res, req, 200, { ok: true, enemies: next.enemies.length, allies: next.allies.length })
      return
    }

    if (method === 'POST' && url.pathname === '/gsi') {
      const body = await readBody(req)
      const result = handleGsi(body || {})
      sendJson(res, req, 200, result)
      return
    }

    if (method === 'GET' && url.pathname === '/') {
      cors(res, req)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>ReplayFace companion</title>
<style>
body{font:15px/1.45 system-ui;background:#0c1014;color:#e8eef5;padding:2rem;max-width:40rem}
code,pre{background:#141b22;padding:.2rem .4rem;border-radius:6px}
a{color:#9ec5ff}
.ok{color:#8af0bf}
</style></head><body>
<h1>ReplayFace companion</h1>
<p class="ok">Running on http://${HOST}:${PORT}</p>
<p>Open the web app → <b>Live lobby</b> and enable listening.</p>
<ul>
<li><code>GET /lobby</code> — current enemies/allies</li>
<li><code>POST /lobby</code> — push Overwolf roster JSON</li>
<li><code>POST /gsi</code> — Dota GSI endpoint</li>
</ul>
<p>Copy <code>gamestate_integration_replayface.cfg</code> into your Dota GSI folder and add <code>-gamestateintegration</code> to Steam launch options.</p>
<pre>${lobby ? JSON.stringify(lobby, null, 2) : 'No lobby yet'}</pre>
</body></html>`)
      return
    }

    sendJson(res, req, 404, { error: 'not found' })
  } catch (e) {
    sendJson(res, req, 500, { error: e instanceof Error ? e.message : 'error' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`ReplayFace companion http://${HOST}:${PORT}`)
  console.log(`  GET  /lobby   — web app polls this`)
  console.log(`  POST /lobby   — Overwolf / manual roster`)
  console.log(`  POST /gsi     — Dota Game State Integration`)
  console.log(`Drop live-lobby.json here to inject a roster: ${LOBBY_FILE}`)
})

// Hot-reload lobby file (Overwolf bridge / scripts can write it)
fs.watchFile(LOBBY_FILE, { interval: 1000 }, () => {
  try {
    if (!fs.existsSync(LOBBY_FILE)) return
    const raw = JSON.parse(fs.readFileSync(LOBBY_FILE, 'utf8'))
    const next = normalizeLobby(raw, raw.source || 'file')
    if (next) {
      lobby = next
      console.log(`[file] lobby updated · ${next.enemies.length} enemies`)
    }
  } catch (e) {
    console.warn('[file] bad live-lobby.json', e.message)
  }
})
