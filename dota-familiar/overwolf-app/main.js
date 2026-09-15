/**
 * ReplayFace Live — Overwolf Dota GEP → local companion
 *
 * Valve / Overwolf: do not reveal enemy steamId/name until
 * DOTA_GAMERULES_STATE_STRATEGY_TIME (after picks).
 */

const DOTA_CLASS_ID = 7314
const FEATURES = ['gep_internal', 'game_state', 'me', 'match_info', 'roster', 'game', 'heroes']

const STEAM64_BASE = 76561197960265728n

const ui = {
  log: document.getElementById('log'),
  companionUrl: document.getElementById('companionUrl'),
  dotaPill: document.getElementById('dotaPill'),
  gepPill: document.getElementById('gepPill'),
  pushPill: document.getElementById('pushPill'),
  pushNow: document.getElementById('pushNow'),
}

let lastMatchState = ''
let lastPushSig = ''
let _lastLobby = null
let _gepReady = false

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`
  ui.log.textContent = `${line}\n${ui.log.textContent}`.slice(0, 4000)
  console.log(line)
}

function setPill(el, text, kind) {
  el.textContent = text
  el.className = `pill ${kind}`
}

function steam64ToAccountId(steam64) {
  if (!steam64) return null
  const s = String(steam64).trim()
  if (!/^\d+$/.test(s)) return null
  try {
    return Number(BigInt(s) - STEAM64_BASE)
  } catch {
    return null
  }
}

function teamFrom(value) {
  if (value === 2 || value === '2' || String(value).toLowerCase() === 'radiant') return 'radiant'
  if (value === 3 || value === '3' || String(value).toLowerCase() === 'dire') return 'dire'
  return null
}

function canRevealIds(matchState) {
  const s = String(matchState || '').toUpperCase()
  return /STRATEGY_TIME|TEAM_SHOWCASE|PRE_GAME|GAME_IN_PROGRESS|POST_GAME/.test(s)
}

function phaseFrom(matchState) {
  const s = String(matchState || '').toUpperCase()
  if (/INIT|PLAYER_DRAFT|WAIT_FOR_PLAYERS_TO_LOAD|WAIT_FOR_MAP|CUSTOM_GAME_SETUP/.test(s)) return 'connecting'
  if (/HERO_SELECTION|STRATEGY_TIME/.test(s) && !/TEAM_SHOWCASE|PRE_GAME|GAME_IN_PROGRESS/.test(s)) {
    if (/STRATEGY_TIME/.test(s)) return 'strategy'
    return 'draft'
  }
  if (/STRATEGY_TIME/.test(s)) return 'strategy'
  if (/TEAM_SHOWCASE|PRE_GAME|GAME_IN_PROGRESS|POST_GAME/.test(s)) return 'live'
  if (/HERO_SELECTION/.test(s)) return 'draft'
  return 'unknown'
}

function parseMaybeJson(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function extractPlayers(info) {
  const roster = info?.roster || {}
  let playersRaw = roster.players ?? roster.roster ?? info?.match_info?.players
  playersRaw = parseMaybeJson(playersRaw)
  if (!playersRaw) return []
  if (Array.isArray(playersRaw)) return playersRaw
  if (typeof playersRaw === 'object') return Object.values(playersRaw)
  return []
}

function extractMatchState(info) {
  return (
    info?.game?.match_state ||
    info?.game_state?.match_state ||
    info?.match_info?.match_state ||
    info?.game?.game_state ||
    lastMatchState ||
    ''
  )
}

function extractMe(info) {
  const me = info?.me || {}
  return {
    steamId: me.steam_id || me.steamId || me.steamid,
    team: teamFrom(me.team) || teamFrom(me.team_name),
  }
}

function mapPlayer(p, me, idsAllowed) {
  const steamId = p.steamId || p.steam_id || p.steamid
  const accountId = idsAllowed ? steam64ToAccountId(steamId) : null
  const team = teamFrom(p.team) || teamFrom(p.teamId) || teamFrom(p.team_name)
  const heroRaw = p.hero
  const heroId = Number(p.heroId || p.hero_id || 0) || 0
  return {
    accountId: idsAllowed ? accountId : null,
    // Never forward name/steamId before STRATEGY_TIME (Valve)
    steamId: idsAllowed && steamId ? String(steamId) : undefined,
    personaname: idsAllowed ? p.name || p.personaname || p.playerName : undefined,
    heroId,
    hero: typeof heroRaw === 'string' ? heroRaw : undefined,
    team: team || 'radiant',
    isOwner: Boolean(idsAllowed && me.steamId && steamId && String(steamId) === String(me.steamId)),
    rank: p.rank != null ? Number(p.rank) : null,
    medalName: p.medal_name || p.medalName,
    medalStars: p.medal_stars != null ? Number(p.medal_stars) : null,
    slotIndex:
      p.team_slot != null
        ? Number(p.team_slot)
        : p.player_index != null
          ? Number(p.player_index)
          : p.index != null
            ? Number(p.index)
            : null,
  }
}

function buildLobby(info) {
  const matchState = extractMatchState(info)
  lastMatchState = String(matchState)
  const phase = phaseFrom(matchState)
  const idsAllowed = canRevealIds(matchState)
  const me = extractMe(info)
  const rawPlayers = extractPlayers(info)

  // Very early connect: match detected, roster may still be empty
  if (!rawPlayers.length) {
    if (!matchState) {
      return { blocked: true, matchState: '', reason: 'No match yet' }
    }
    return {
      blocked: false,
      source: 'overwolf',
      gameState: lastMatchState,
      phase,
      myTeam: me.team || 'radiant',
      ownerSteamId: idsAllowed ? me.steamId : undefined,
      matchStartedAt: Date.now(),
      players: [],
      enemies: [],
      allies: [],
      awaitingRoster: true,
      awaitingIds: true,
    }
  }

  const players = rawPlayers.map((p) => mapPlayer(p, me, idsAllowed))
  // During draft Overwolf may leave team=0; still keep slots for rank/medal UI
  const usable = players.filter(
    (p) =>
      p.accountId ||
      p.personaname ||
      p.heroId ||
      p.hero ||
      p.rank != null ||
      p.medalName ||
      p.slotIndex != null,
  )

  if (!usable.length) {
    return {
      blocked: true,
      matchState: lastMatchState,
      reason: `Match ${phase} — roster empty`,
    }
  }

  const owner = usable.find((p) => p.isOwner)
  const myTeam = owner?.team || me.team || 'radiant'
  // If teams unknown during draft, treat non-owner as enemies for display slots
  const enemies = usable.filter((p) => !p.isOwner && p.team !== myTeam)
  const allies = usable.filter((p) => p.isOwner || p.team === myTeam)
  const withIds = usable.filter((p) => p.accountId).length

  return {
    blocked: false,
    source: 'overwolf',
    gameState: lastMatchState,
    phase,
    myTeam,
    ownerSteamId: idsAllowed ? me.steamId : undefined,
    matchStartedAt: Date.now(),
    players: usable,
    enemies: enemies.length ? enemies : usable.filter((p) => !p.isOwner),
    allies: allies.length ? allies : usable.filter((p) => p.isOwner),
    awaitingRoster: withIds < 2,
    awaitingIds: !idsAllowed || withIds < 2,
  }
}

async function pushLobby(lobby) {
  const url = (ui.companionUrl.value || 'http://127.0.0.1:17321/lobby').trim()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lobby),
  })
  if (!res.ok) throw new Error(`companion HTTP ${res.status}`)
  return res.json()
}

function lobbySig(lobby) {
  if (!lobby || lobby.blocked) return ''
  return [
    lobby.phase,
    lobby.awaitingIds ? '1' : '0',
    lobby.players
      .map((p) => `${p.accountId || ''}:${p.team}:${p.hero || p.heroId}:${p.rank || ''}:${p.medalName || ''}`)
      .join('|'),
  ].join('::')
}

async function maybePushFromInfo(info, force = false) {
  const lobby = buildLobby(info)
  _lastLobby = lobby
  if (lobby.blocked) {
    setPill(ui.pushPill, String(lobby.reason || 'Blocked').slice(0, 42), 'wait')
    return
  }
  const sig = lobbySig(lobby)
  if (!force && sig === lastPushSig) return
  try {
    const result = await pushLobby(lobby)
    lastPushSig = sig
    if (lobby.awaitingIds) {
      setPill(ui.pushPill, `${lobby.phase || 'early'} · ranks only`, 'wait')
      log(`Early lobby (${lobby.phase}) · IDs after STRATEGY_TIME · ${lobby.enemies.length} enemy slots`)
    } else {
      setPill(ui.pushPill, `Pushed ${lobby.enemies.length} enemies`, 'ok')
      log(`Pushed roster · ${lobby.enemies.length} enemies · ${JSON.stringify(result)}`)
    }
  } catch (e) {
    setPill(ui.pushPill, 'Companion offline', 'off')
    log(`Push failed: ${e.message || e}`)
  }
}

function registerGepListeners() {
  overwolf.games.events.onError.addListener((info) => {
    log(`GEP error: ${JSON.stringify(info)}`)
  })

  overwolf.games.events.onInfoUpdates2.addListener((update) => {
    // Prefer full snapshot so we always see roster + me + match_state together
    overwolf.games.events.getInfo((info) => {
      if (info.status !== 'success') return
      const res = info.res || info
      void maybePushFromInfo(res)
    })
    // Also try parsing the delta when it carries roster/game
    if (update?.info) {
      void maybePushFromInfo(update.info)
    }
  })

  overwolf.games.events.onNewEvents.addListener((e) => {
    const events = e?.events || []
    for (const ev of events) {
      if (ev.name === 'game_state_changed' || ev.name === 'match_state_changed') {
        const data = parseMaybeJson(ev.data) || {}
        if (data.match_state) lastMatchState = String(data.match_state)
        overwolf.games.events.getInfo((info) => {
          if (info.status === 'success') void maybePushFromInfo(info.res || info)
        })
      }
    }
  })
}

function setRequiredFeatures(attempt = 0) {
  overwolf.games.events.setRequiredFeatures(FEATURES, (info) => {
    if (info.status === 'error') {
      setPill(ui.gepPill, 'GEP retry…', 'wait')
      if (attempt < 30) setTimeout(() => setRequiredFeatures(attempt + 1), 2000)
      else log(`Could not set features: ${info.reason || JSON.stringify(info)}`)
      return
    }
    _gepReady = true
    setPill(ui.gepPill, 'GEP ready', 'ok')
    log(`Features: ${(info.supportedFeatures || FEATURES).join(', ')}`)
    overwolf.games.events.getInfo((gi) => {
      if (gi.status === 'success') void maybePushFromInfo(gi.res || gi)
    })
  })
}

function isDota(gameInfo) {
  if (!gameInfo?.isRunning) return false
  return Math.floor(Number(gameInfo.id) / 10) === DOTA_CLASS_ID
}

function onDotaRunning() {
  setPill(ui.dotaPill, 'Dota running', 'ok')
  registerGepListeners()
  setTimeout(() => setRequiredFeatures(0), 800)
}

window.addEventListener('load', () => {
  if (typeof overwolf === 'undefined') {
    setPill(ui.dotaPill, 'Open inside Overwolf', 'off')
    log('overwolf API missing — load this app from Overwolf client')
    return
  }

  ui.pushNow.addEventListener('click', () => {
    overwolf.games.events.getInfo((info) => {
      if (info.status !== 'success') {
        log('getInfo failed')
        return
      }
      void maybePushFromInfo(info.res || info, true)
    })
  })

  overwolf.games.onGameInfoUpdated.addListener((res) => {
    if (res?.gameInfo && isDota(res.gameInfo)) onDotaRunning()
    else if (res?.gameInfo && !res.gameInfo.isRunning) {
      setPill(ui.dotaPill, 'Dota offline', 'off')
      setPill(ui.gepPill, 'GEP off', 'off')
    }
  })

  overwolf.games.getRunningGameInfo((res) => {
    if (isDota(res)) onDotaRunning()
    else setPill(ui.dotaPill, 'Dota offline', 'off')
  })

  log('ReplayFace Live ready')
})
