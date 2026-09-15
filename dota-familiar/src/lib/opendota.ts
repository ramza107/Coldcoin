import type {
  AccountId,
  FamiliarIndex,
  FamiliarRecord,
  MatchPlayer,
  PlayerProfile,
  RecentMatchBrief,
} from '../types'

const STEAM64_BASE = 76561197960265728n

export function steam64ToAccountId(steam64: string | bigint): AccountId {
  return Number(BigInt(steam64) - STEAM64_BASE)
}

export async function resolveAccountId(input: string): Promise<AccountId> {
  const raw = input.trim()
  if (!raw) throw new Error('Enter a Steam / OpenDota profile or ID')

  const opendota = raw.match(/opendota\.com\/players\/(\d+)/i)
  if (opendota) return Number(opendota[1])

  const profile = raw.match(/steamcommunity\.com\/profiles\/(\d+)/i)
  if (profile) return steam64ToAccountId(profile[1])

  const vanity = raw.match(/steamcommunity\.com\/id\/([^/?\s]+)/i)
  if (vanity) {
    const hits = await searchPlayers(vanity[1])
    if (!hits.length) throw new Error('Could not resolve that Steam vanity URL')
    return hits[0].accountId
  }

  if (/^\d{17}$/.test(raw)) return steam64ToAccountId(raw)
  if (/^\d{3,12}$/.test(raw)) return Number(raw)

  const hits = await searchPlayers(raw)
  if (!hits.length) throw new Error('Player not found. Try account ID or profile URL.')
  return hits[0].accountId
}

async function api<T>(path: string): Promise<T> {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const local = host === '127.0.0.1' || host === 'localhost'
  const base = import.meta.env.DEV || local ? '/opendota' : 'https://api.opendota.com/api'

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch(`${base}${path}`, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`OpenDota error ${res.status}`)
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('OpenDota timeout — check internet / companion proxy')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export async function searchPlayers(q: string): Promise<PlayerProfile[]> {
  const query = q.trim()
  if (!query) return []
  const data = await api<Array<{ account_id: number; personaname: string; avatarfull?: string }>>(
    `/search?q=${encodeURIComponent(query)}`,
  )
  const needle = query.toLowerCase()
  return data
    .slice(0, 16)
    .map((p) => ({
      accountId: p.account_id,
      personaname: p.personaname,
      avatarfull: p.avatarfull,
    }))
    .sort((a, b) => {
      const an = a.personaname.toLowerCase()
      const bn = b.personaname.toLowerCase()
      const aExact = an === needle ? 0 : an.startsWith(needle) ? 1 : 2
      const bExact = bn === needle ? 0 : bn.startsWith(needle) ? 1 : 2
      return aExact - bExact
    })
}

/** Prefer exact nick among search hits; otherwise leave for manual pick. */
export function bestExactNickHit(hits: PlayerProfile[], nick: string): PlayerProfile | null {
  const needle = nick.trim().toLowerCase()
  if (!needle) return null
  const exact = hits.filter((h) => h.personaname.toLowerCase() === needle)
  return exact.length === 1 ? exact[0] : null
}

export async function fetchPlayer(accountId: AccountId): Promise<PlayerProfile> {
  const [data, wl] = await Promise.all([
    api<{
      profile?: {
        personaname?: string
        avatarfull?: string
        profileurl?: string
      }
      rank_tier?: number | null
      leaderboard_rank?: number | null
    }>(`/players/${accountId}`),
    api<{ win: number; lose: number }>(`/players/${accountId}/wl`).catch(() => ({ win: 0, lose: 0 })),
  ])

  return {
    accountId,
    personaname: data.profile?.personaname || `Player ${accountId}`,
    avatarfull: data.profile?.avatarfull,
    profileurl: data.profile?.profileurl,
    rankTier: data.rank_tier ?? null,
    leaderboardRank: data.leaderboard_rank ?? null,
    wins: wl.win,
    losses: wl.lose,
  }
}

interface MatchListItem {
  match_id: number
  player_slot: number
}

interface MatchDetail {
  match_id: number
  radiant_win: boolean
  start_time: number
  players: Array<{
    account_id?: number | null
    personaname?: string
    player_slot: number
    hero_id: number
    kills?: number
    deaths?: number
    assists?: number
    net_worth?: number
    gold_per_min?: number
    xp_per_min?: number
    level?: number
  }>
}

export async function fetchRecentMatches(accountId: AccountId, limit = 50): Promise<MatchListItem[]> {
  return api(`/players/${accountId}/matches?limit=${limit}`)
}

export async function fetchLatestMatchId(accountId: AccountId): Promise<number | null> {
  const recent = await fetchRecentMatches(accountId, 1)
  return recent[0]?.match_id ?? null
}

interface RecentMatchApiRow {
  match_id: number
  player_slot: number
  radiant_win: boolean
  hero_id: number
  kills: number
  deaths: number
  assists: number
  start_time: number
  duration?: number
  lobby_type?: number
}

/** Last N finished matches for a player (enemy intel at lobby time). */
export async function fetchPlayerRecentBrief(
  accountId: AccountId,
  limit = 5,
): Promise<RecentMatchBrief[]> {
  const rows = await api<RecentMatchApiRow[]>(`/players/${accountId}/matches?limit=${limit}`)
  return rows.map((m) => {
    const isRadiant = m.player_slot < 128
    const win = (isRadiant && m.radiant_win) || (!isRadiant && !m.radiant_win)
    return {
      matchId: m.match_id,
      heroId: m.hero_id,
      win,
      kills: m.kills,
      deaths: m.deaths,
      assists: m.assists,
      startTime: m.start_time,
      duration: m.duration,
      lobbyType: m.lobby_type,
    }
  })
}

export async function fetchMatch(matchId: number): Promise<MatchDetail> {
  return api(`/matches/${matchId}`)
}

/** Merge one match into an existing familiar index (for auto-watch updates). */
export function absorbMatchIntoIndex(
  index: FamiliarIndex,
  detail: MatchDetail,
): FamiliarIndex {
  const ownerAccountId = index.ownerAccountId
  const ownerRow = detail.players.find((p) => p.account_id === ownerAccountId)
  if (!ownerRow) return index

  const ownerTeam = slotTeam(ownerRow.player_slot)
  const ownerWon =
    (ownerTeam === 'radiant' && detail.radiant_win) ||
    (ownerTeam === 'dire' && !detail.radiant_win)

  const players = { ...index.players }

  for (const p of detail.players) {
    if (!p.account_id || p.account_id === ownerAccountId) continue
    const key = String(p.account_id)
    const team = slotTeam(p.player_slot)
    const asAlly = team === ownerTeam
    const base: FamiliarRecord = players[key]
      ? { ...players[key] }
      : {
          accountId: p.account_id,
          personaname: p.personaname || `Player ${p.account_id}`,
          games: 0,
          asAlly: 0,
          asEnemy: 0,
          winsWith: 0,
          winsAgainst: 0,
          lastMatchId: detail.match_id,
          lastPlayedAt: detail.start_time,
        }

    // Avoid double-counting the same match
    if (base.lastMatchId === detail.match_id && base.games > 0 && players[key]) {
      continue
    }

    base.personaname = p.personaname || base.personaname
    base.games += 1
    if (asAlly) {
      base.asAlly += 1
      if (ownerWon) base.winsWith += 1
    } else {
      base.asEnemy += 1
      if (ownerWon) base.winsAgainst += 1
    }
    if (detail.start_time >= base.lastPlayedAt) {
      base.lastPlayedAt = detail.start_time
      base.lastMatchId = detail.match_id
    }
    players[key] = base
  }

  return {
    ...index,
    players,
    syncedAt: Date.now(),
  }
}

function slotTeam(slot: number): 'radiant' | 'dire' {
  return slot < 128 ? 'radiant' : 'dire'
}

export async function buildFamiliarIndex(
  ownerAccountId: AccountId,
  matchLimit = 40,
  onProgress?: (done: number, total: number) => void,
): Promise<FamiliarIndex> {
  const owner = await fetchPlayer(ownerAccountId)
  const recent = await fetchRecentMatches(ownerAccountId, matchLimit)
  const players: Record<string, FamiliarRecord> = {}
  const total = recent.length
  let done = 0

  for (const m of recent) {
    try {
      const detail = await fetchMatch(m.match_id)
      const ownerRow = detail.players.find((p) => p.account_id === ownerAccountId)
      const ownerTeam = ownerRow ? slotTeam(ownerRow.player_slot) : slotTeam(m.player_slot)
      const ownerWon =
        (ownerTeam === 'radiant' && detail.radiant_win) ||
        (ownerTeam === 'dire' && !detail.radiant_win)

      for (const p of detail.players) {
        if (!p.account_id || p.account_id === ownerAccountId) continue
        const key = String(p.account_id)
        const team = slotTeam(p.player_slot)
        const asAlly = team === ownerTeam
        const base: FamiliarRecord = players[key] || {
          accountId: p.account_id,
          personaname: p.personaname || `Player ${p.account_id}`,
          games: 0,
          asAlly: 0,
          asEnemy: 0,
          winsWith: 0,
          winsAgainst: 0,
          lastMatchId: detail.match_id,
          lastPlayedAt: detail.start_time,
        }

        base.personaname = p.personaname || base.personaname
        base.games += 1
        if (asAlly) {
          base.asAlly += 1
          if (ownerWon) base.winsWith += 1
        } else {
          base.asEnemy += 1
          if (ownerWon) base.winsAgainst += 1
        }
        if (detail.start_time >= base.lastPlayedAt) {
          base.lastPlayedAt = detail.start_time
          base.lastMatchId = detail.match_id
        }
        players[key] = base
      }
    } catch {
      // skip broken/missing matches
    }

    done += 1
    onProgress?.(done, total)
    await new Promise((r) => setTimeout(r, 120))
  }

  return {
    ownerAccountId,
    ownerName: owner.personaname,
    ownerAvatar: owner.avatarfull,
    syncedAt: Date.now(),
    matchesScanned: total,
    players,
  }
}

export function matchPlayersFromDetail(detail: MatchDetail, ownerAccountId?: AccountId): MatchPlayer[] {
  return detail.players.map((p) => {
    const team = slotTeam(p.player_slot)
    const win =
      (team === 'radiant' && detail.radiant_win) || (team === 'dire' && !detail.radiant_win)
    return {
      accountId: p.account_id ?? null,
      personaname: p.personaname,
      heroId: p.hero_id,
      team,
      win,
      isOwner: ownerAccountId != null && p.account_id === ownerAccountId,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      netWorth: p.net_worth,
      gpm: p.gold_per_min,
      xpm: p.xp_per_min,
      level: p.level,
    }
  })
}

export function accountIdToSteam64(accountId: AccountId): string {
  return (BigInt(accountId) + STEAM64_BASE).toString()
}

export function winrate(wins?: number, losses?: number): string | null {
  if (wins == null || losses == null) return null
  const total = wins + losses
  if (!total) return null
  return `${((wins / total) * 100).toFixed(1)}%`
}

export function rankLabel(rankTier?: number | null): string {
  if (!rankTier) return 'Uncalibrated'
  const medal = Math.floor(rankTier / 10)
  const stars = rankTier % 10
  const names = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal']
  const name = names[medal] || 'Ranked'
  return medal === 8 ? name : `${name} ${stars}`
}
