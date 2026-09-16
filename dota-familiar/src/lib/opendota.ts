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
    const { hits } = await searchPlayers(vanity[1])
    if (!hits.length) throw new Error('Could not resolve that Steam vanity URL')
    return hits[0].accountId
  }

  if (/^\d{17}$/.test(raw)) return steam64ToAccountId(raw)
  if (/^\d{3,12}$/.test(raw)) return Number(raw)

  const { hits } = await searchPlayers(raw)
  if (!hits.length) throw new Error('Player not found. Try account ID or profile URL.')
  return hits[0].accountId
}

async function api<T>(path: string, timeoutMs = 18000): Promise<T> {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const local = host === '127.0.0.1' || host === 'localhost'
  // Always prefer same-origin companion proxy when UI is served locally
  const base = import.meta.env.DEV || local ? '/opendota' : 'https://api.opendota.com/api'

  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}${path}`, { signal: ctrl.signal, cache: 'no-store' })
      if (!res.ok) {
        // companion may return JSON { error, hint }
        let detail = `OpenDota error ${res.status}`
        try {
          const body = (await res.json()) as { detail?: string; hint?: string; error?: string }
          detail = body.detail || body.error || detail
          if (body.hint) detail = `${detail} — ${body.hint}`
        } catch {
          // ignore
        }
        throw new Error(detail)
      }
      return (await res.json()) as T
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        lastErr = new Error(
          'OpenDota не отвечает (таймаут). Попробуй Refresh ещё раз или VPN — api.opendota.com часто тупит/блокируется.',
        )
      } else {
        lastErr = e instanceof Error ? e : new Error(String(e))
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr || new Error('OpenDota request failed')
}

/** Strip lobby truncation / clan tags so OpenDota search has a chance. */
export function normalizeNick(raw: string): string {
  return raw
    .replace(/\u2026/g, '...')
    .replace(/\.{2,}$/g, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/[«»""„]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function nickQueryVariants(raw: string): string[] {
  const base = normalizeNick(raw)
  if (!base) return []
  const out: string[] = []
  const push = (s: string) => {
    const t = s.trim()
    if (t.length >= 2 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  push(base)
  push(base.replace(/[^\p{L}\p{N}_.\- ]+/gu, ' ').replace(/\s+/g, ' '))
  const noSpace = base.replace(/\s+/g, '')
  if (noSpace.length >= 3) push(noSpace)
  const first = base.split(/\s+/)[0]
  if (first && first.length >= 3) push(first)
  // Truncated lobby names: keep a solid prefix for OpenDota
  if (base.length >= 8) push(base.slice(0, Math.min(12, base.length)))
  if (base.length >= 6) push(base.slice(0, 6))
  return out.slice(0, 4)
}

function nickScore(personaname: string, needle: string): number {
  const n = personaname.toLowerCase()
  const q = needle.toLowerCase()
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  if (n.includes(q)) return 60
  const core = q.replace(/[^a-z0-9а-яё]/gi, '')
  const nc = n.replace(/[^a-z0-9а-яё]/gi, '')
  if (core && nc === core) return 90
  if (core && nc.startsWith(core)) return 70
  if (core && nc.includes(core)) return 40
  return 10
}

const searchCache = new Map<
  string,
  {
    at: number
    hits: PlayerProfile[]
    links?: Array<{ provider: string; label: string; url: string }>
    providers?: string[]
  }
>()
const SEARCH_CACHE_MS = 5 * 60 * 1000

export function searchFamiliarFuzzy(index: FamiliarIndex, nick: string): PlayerProfile[] {
  const variants = nickQueryVariants(nick)
  if (!variants.length) return []
  const scored: Array<{ p: PlayerProfile; score: number }> = []
  for (const rec of Object.values(index.players)) {
    let best = 0
    for (const v of variants) best = Math.max(best, nickScore(rec.personaname, v))
    if (best >= 40) {
      scored.push({
        p: {
          accountId: rec.accountId,
          personaname: rec.personaname,
          avatarfull: rec.avatar,
        },
        score: best,
      })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 12).map((s) => s.p)
}

async function searchOpenDotaOnce(q: string): Promise<PlayerProfile[]> {
  const data = await api<Array<{ account_id: number; personaname: string; avatarfull?: string }>>(
    `/search?q=${encodeURIComponent(q)}`,
    12000,
  )
  return (Array.isArray(data) ? data : []).slice(0, 20).map((p) => ({
    accountId: p.account_id,
    personaname: p.personaname || `Player ${p.account_id}`,
    avatarfull: p.avatarfull,
  }))
}

export class NickSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NickSearchUnavailableError'
  }
}

/** Companion-backed nick search: OpenDota + Steam + Dotabuff/Stratz fallbacks. */
export async function searchPlayersViaCompanion(
  companionRoot: string,
  nick: string,
): Promise<{
  hits: PlayerProfile[]
  degraded?: boolean
  error?: string
  providers?: string[]
  links?: Array<{ provider: string; label: string; url: string }>
}> {
  const root = companionRoot.replace(/\/$/, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 22000)
  try {
    const res = await fetch(`${root}/search-nick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: nick }),
      signal: ctrl.signal,
      cache: 'no-store',
    })
    const data = (await res.json()) as {
      hits?: Array<{
        account_id?: number
        accountId?: number
        personaname?: string
        avatarfull?: string
        profileurl?: string
        source?: string
      }>
      ok?: boolean
      error?: string
      degraded?: boolean
      providers?: string[]
      links?: Array<{ provider: string; label: string; url: string }>
    }
    const hits = (data.hits || [])
      .map((p) => ({
        accountId: Number(p.accountId ?? p.account_id),
        personaname: p.personaname || `Player ${p.accountId ?? p.account_id}`,
        avatarfull: p.avatarfull,
        profileurl: p.profileurl,
        source: p.source,
      }))
      .filter((p) => Number.isFinite(p.accountId))
    if (!res.ok && !hits.length) {
      return {
        hits: [],
        degraded: true,
        error: data.error || `search-nick ${res.status}`,
        providers: data.providers,
        links: data.links,
      }
    }
    return {
      hits,
      degraded: Boolean(data.degraded),
      error: data.error,
      providers: data.providers,
      links: data.links,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function searchPlayers(
  q: string,
  companionUrl?: string,
): Promise<{
  hits: PlayerProfile[]
  links?: Array<{ provider: string; label: string; url: string }>
  providers?: string[]
  error?: string
}> {
  const query = q.trim()
  if (!query) return { hits: [] }
  const cacheKey = query.toLowerCase()
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) {
    return { hits: cached.hits, links: cached.links, providers: cached.providers }
  }

  const variants = nickQueryVariants(query)
  const needle = normalizeNick(query) || query
  let hits: PlayerProfile[] = []
  let links: Array<{ provider: string; label: string; url: string }> | undefined
  let providers: string[] | undefined
  let networkFailed = false
  let lastNetError = ''

  // Prefer companion multi-provider search whenever we have a companion URL
  if (companionUrl) {
    try {
      const remote = await searchPlayersViaCompanion(companionUrl, query)
      hits = remote.hits
      links = remote.links
      providers = remote.providers
      if (remote.degraded || remote.error) {
        networkFailed = hits.length === 0
        lastNetError = remote.error || 'search degraded'
      }
    } catch (e) {
      networkFailed = true
      lastNetError = e instanceof Error ? e.message : String(e)
      hits = []
    }
  }

  if (!hits.length && !companionUrl) {
    let anyOk = false
    const batches = await Promise.all(
      variants.map(async (v) => {
        try {
          const list = await searchOpenDotaOnce(v)
          anyOk = true
          return list
        } catch (e) {
          lastNetError = e instanceof Error ? e.message : String(e)
          return [] as PlayerProfile[]
        }
      }),
    )
    if (!anyOk) networkFailed = true
    const byId = new Map<number, PlayerProfile>()
    for (const list of batches) {
      for (const p of list) {
        if (!byId.has(p.accountId)) byId.set(p.accountId, p)
      }
    }
    hits = [...byId.values()]
  }

  if (!links?.length) {
    const enc = encodeURIComponent(needle)
    links = [
      { provider: 'dotabuff', label: 'Dotabuff', url: `https://www.dotabuff.com/search?q=${enc}` },
      { provider: 'stratz', label: 'Stratz', url: `https://stratz.com/players?q=${enc}` },
      { provider: 'steam', label: 'Steam', url: `https://steamcommunity.com/search/users/?text=${enc}` },
      { provider: 'opendota', label: 'OpenDota', url: `https://www.opendota.com/search?q=${enc}` },
    ]
  }

  hits = hits
    .map((p) => ({ p, score: nickScore(p.personaname, needle) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p)
    .slice(0, 16)

  if (hits.length || !networkFailed) {
    searchCache.set(cacheKey, { at: Date.now(), hits, links, providers })
  }

  // Don't throw when we can still offer manual search links — UI shows them
  if (!hits.length && networkFailed) {
    return {
      hits: [],
      links,
      providers,
      error:
        lastNetError && !/dotabuff:\s*HTTP 403/i.test(lastNetError)
          ? lastNetError
          : 'Автопоиск не нашёл игрока — открой Steam/Dotabuff/Stratz по ссылкам',
    }
  }

  return { hits, links, providers }
}

/** Prefer exact nick among search hits; otherwise leave for manual pick. */
export function bestExactNickHit(hits: PlayerProfile[], nick: string): PlayerProfile | null {
  const needle = normalizeNick(nick).toLowerCase() || nick.trim().toLowerCase()
  if (!needle) return null
  const exact = hits.filter((h) => normalizeNick(h.personaname).toLowerCase() === needle)
  return exact.length === 1 ? exact[0] : null
}

/** Strong single candidate: exact, or one clear prefix hit. */
export function bestConfidentNickHit(hits: PlayerProfile[], nick: string): PlayerProfile | null {
  const exact = bestExactNickHit(hits, nick)
  if (exact) return exact
  if (hits.length === 1) return hits[0]
  const needle = normalizeNick(nick).toLowerCase()
  const strong = hits.filter((h) => nickScore(h.personaname, needle) >= 80)
  return strong.length === 1 ? strong[0] : null
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
