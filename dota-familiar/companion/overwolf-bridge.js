/**
 * Minimal Overwolf → ReplayFace bridge.
 * Drop into an Overwolf app window and load after Dota GEP features are ready.
 *
 * Required GEP features (retry setRequiredFeatures):
 *   me, match_info, roster, heroes, game_state
 *
 * Valve/Overwolf compliance: only push roster AFTER pick phase ends
 * (strategy time / team showcase / pre-game) — never during draft picks.
 */

const COMPANION = 'http://127.0.0.1:17321/lobby'
const DOTA_CLASS_ID = 7314

function steam64ToAccountId(steam64) {
  return Number(BigInt(steam64) - 76561197960265728n)
}

function teamFrom(value) {
  const v = String(value ?? '').toLowerCase()
  if (v.includes('radiant') || v === '2') return 'radiant'
  if (v.includes('dire') || v === '3') return 'dire'
  return null
}

function canRevealRoster(gameState) {
  const s = String(gameState || '').toUpperCase()
  // After picks only
  return /STRATEGY|TEAM_SHOWCASE|PRE_GAME|GAME_IN_PROGRESS|POST_GAME/.test(s)
}

async function pushLobby(payload) {
  await fetch(COMPANION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function rosterFromInfo(info) {
  const roster = info?.roster || info?.match_info?.roster || {}
  const me = info?.me || info?.match_info?.me || {}
  const gameState =
    info?.game_state?.game_state ||
    info?.match_info?.game_state ||
    info?.game_state ||
    ''

  if (!canRevealRoster(gameState)) return null

  const players = Object.values(roster).map((p) => {
    const steamId = p.steam_id || p.steamId || p.steamid
    const accountId = steamId ? steam64ToAccountId(String(steamId)) : Number(p.account_id || p.accountId) || null
    return {
      accountId,
      steamId,
      personaname: p.name || p.playerName || p.personaname,
      heroId: Number(p.hero_id || p.heroId || 0) || 0,
      team: teamFrom(p.team || p.team_name),
      isOwner: Boolean(p.is_local || p.isLocal || (me.steam_id && steamId === me.steam_id)),
    }
  })

  const myTeam =
    teamFrom(me.team) ||
    players.find((p) => p.isOwner)?.team ||
    'radiant'

  return {
    source: 'overwolf',
    gameState: String(gameState),
    myTeam,
    ownerSteamId: me.steam_id || me.steamId,
    players,
  }
}

function wireOverwolf() {
  if (typeof overwolf === 'undefined') {
    console.warn('ReplayFace bridge: overwolf API missing')
    return
  }

  const features = ['me', 'match_info', 'roster', 'heroes', 'game_state']

  function trySetFeatures(attempt = 0) {
    overwolf.games.events.setRequiredFeatures(features, (result) => {
      if (result.status === 'success') {
        console.log('ReplayFace: GEP features ready')
        return
      }
      if (attempt < 20) setTimeout(() => trySetFeatures(attempt + 1), 2000)
    })
  }

  overwolf.games.events.onInfoUpdates2.addListener(async (_update) => {
    try {
      overwolf.games.events.getInfo(async (info) => {
        if (info.status !== 'success') return
        const lobby = rosterFromInfo(info.res || info)
        if (!lobby || lobby.players.filter((p) => p.accountId).length < 2) return
        await pushLobby(lobby)
      })
    } catch (e) {
      console.warn('ReplayFace push failed', e)
    }
  })

  overwolf.games.onGameInfoUpdated.addListener((e) => {
    if (e?.gameInfo?.classId === DOTA_CLASS_ID && e.gameInfo.isRunning) {
      trySetFeatures()
    }
  })

  trySetFeatures()
}

wireOverwolf()
