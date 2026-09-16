import https from 'node:https'
import http from 'node:http'

const agent = new https.Agent({
  keepAlive: true,
  family: 4, // OpenDota IPv6 often hangs in some regions
  maxSockets: 8,
})

/**
 * Fetch JSON from OpenDota with timeout + retries (Node side).
 * Browser often hangs; companion is more reliable.
 */
export function opendotaGet(apiPath, { timeoutMs = 20000, retries = 3 } = {}) {
  const path = apiPath.startsWith('/api') ? apiPath : `/api${apiPath.startsWith('/') ? '' : '/'}${apiPath}`
  const url = `https://api.opendota.com${path}`

  const once = () =>
    new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          agent,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ReplayFace-Companion/1.2',
            'Accept-Encoding': 'identity',
          },
          timeout: timeoutMs,
          family: 4,
        },
        (res) => {
          // follow one redirect
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            https
              .get(
                res.headers.location,
                {
                  agent,
                  headers: { Accept: 'application/json', 'User-Agent': 'ReplayFace-Companion/1.2' },
                  timeout: timeoutMs,
                  family: 4,
                },
                (res2) => collect(res2, resolve, reject),
              )
              .on('timeout', function () {
                this.destroy()
                reject(new Error(`OpenDota timeout after ${timeoutMs}ms`))
              })
              .on('error', reject)
            return
          }
          collect(res, resolve, reject)
        },
      )
      req.on('timeout', () => {
        req.destroy()
        reject(new Error(`OpenDota timeout after ${timeoutMs}ms`))
      })
      req.on('error', reject)
    })

  function collect(res, resolve, reject) {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`OpenDota HTTP ${res.statusCode}: ${text.slice(0, 180)}`))
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error(`OpenDota bad JSON: ${text.slice(0, 120)}`))
      }
    })
  }

  return (async () => {
    let last
    for (let i = 0; i < retries; i++) {
      try {
        return await once()
      } catch (e) {
        last = e
        await new Promise((r) => setTimeout(r, 400 * (i + 1)))
      }
    }
    throw last
  })()
}

export async function pingOpenDota() {
  const started = Date.now()
  const data = await opendotaGet('/api/heroes', { timeoutMs: 15000, retries: 2 })
  return {
    ok: Array.isArray(data),
    ms: Date.now() - started,
    sample: Array.isArray(data) ? data.length : 0,
  }
}

const STEAM64_BASE = 76561197960265728n

export function resolveAccountIdLocal(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('Empty profile')
  const od = raw.match(/opendota\.com\/players\/(\d+)/i)
  if (od) return Number(od[1])
  const st = raw.match(/steamcommunity\.com\/profiles\/(\d+)/i)
  if (st) return Number(BigInt(st[1]) - STEAM64_BASE)
  if (/^\d{17}$/.test(raw)) return Number(BigInt(raw) - STEAM64_BASE)
  if (/^\d{3,12}$/.test(raw)) return Number(raw)
  return null
}

function slotTeam(slot) {
  return slot < 128 ? 'radiant' : 'dire'
}

/** Build familiar index entirely on companion (avoids browser timeouts). */
export async function buildFamiliarIndexServer(accountId, matchLimit = 15, onProgress) {
  const [player, wl, recent] = await Promise.all([
    opendotaGet(`/api/players/${accountId}`, { timeoutMs: 30000, retries: 3 }),
    opendotaGet(`/api/players/${accountId}/wl`, { timeoutMs: 30000, retries: 2 }).catch(() => ({
      win: 0,
      lose: 0,
    })),
    opendotaGet(`/api/players/${accountId}/matches?limit=${matchLimit}`, {
      timeoutMs: 30000,
      retries: 3,
    }),
  ])

  const players = {}
  const total = recent.length
  let done = 0

  for (const m of recent) {
    try {
      const detail = await opendotaGet(`/api/matches/${m.match_id}`, { timeoutMs: 35000, retries: 2 })
      const ownerRow = detail.players?.find((p) => p.account_id === accountId)
      const ownerTeam = ownerRow ? slotTeam(ownerRow.player_slot) : slotTeam(m.player_slot)
      const ownerWon =
        (ownerTeam === 'radiant' && detail.radiant_win) || (ownerTeam === 'dire' && !detail.radiant_win)

      for (const p of detail.players || []) {
        if (!p.account_id || p.account_id === accountId) continue
        const key = String(p.account_id)
        const team = slotTeam(p.player_slot)
        const asAlly = team === ownerTeam
        const base = players[key] || {
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
    } catch (e) {
      console.warn(`[sync] skip match ${m.match_id}:`, e.message || e)
    }
    done += 1
    onProgress?.(done, total)
    await new Promise((r) => setTimeout(r, 250))
  }

  return {
    ownerAccountId: accountId,
    ownerName: player.profile?.personaname || `Player ${accountId}`,
    ownerAvatar: player.profile?.avatarfull,
    syncedAt: Date.now(),
    matchesScanned: total,
    players,
    ownerWl: { wins: wl.win, losses: wl.lose },
  }
}

export function nickQueryVariants(raw) {
  const base = String(raw || '')
    .replace(/\u2026/g, '...')
    .replace(/\.{2,}$/g, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/[«»""„]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) return []
  const out = []
  const push = (s) => {
    const t = String(s || '').trim()
    if (t.length >= 2 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  push(base)
  push(base.replace(/[^\p{L}\p{N}_.\- ]+/gu, ' ').replace(/\s+/g, ' '))
  const noSpace = base.replace(/\s+/g, '')
  if (noSpace.length >= 3) push(noSpace)
  const first = base.split(/\s+/)[0]
  if (first && first.length >= 3) push(first)
  if (base.length >= 8) push(base.slice(0, Math.min(12, base.length)))
  if (base.length >= 6) push(base.slice(0, 6))
  return out.slice(0, 4)
}

function nickScore(personaname, needle) {
  const n = String(personaname || '').toLowerCase()
  const q = String(needle || '').toLowerCase()
  if (!n || !q) return 0
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

const STEAM64_BASE_N = 76561197960265728n

function httpGetText(url, { timeoutMs = 12000, headers = {}, cookieJar } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.get(
      url,
      {
        family: 4,
        timeout: timeoutMs,
        headers: {
          Accept: 'text/html,application/json,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          ...(cookieJar ? { Cookie: cookieJar } : {}),
          ...headers,
        },
      },
      (res) => {
        const setCookie = res.headers['set-cookie']
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${u.host}`))
            return
          }
          resolve({ text, status: res.statusCode || 0, setCookie })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`timeout ${u.host}`))
    })
    req.on('error', reject)
  })
}

function cookiesFromSetCookie(setCookie) {
  if (!setCookie?.length) return ''
  return setCookie.map((c) => String(c).split(';')[0]).join('; ')
}

/** Steam Community people search — works when OpenDota /search is down. */
export async function searchSteamCommunity(rawNick) {
  const q = nickQueryVariants(rawNick)[0] || String(rawNick || '').trim()
  if (!q) return []
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) await new Promise((r) => setTimeout(r, 800))
      const page = await httpGetText(
        `https://steamcommunity.com/search/users/?text=${encodeURIComponent(q)}`,
        { timeoutMs: 12000 },
      )
      const session =
        page.text.match(/g_sessionID\s*=\s*"([^"]+)"/)?.[1] ||
        cookiesFromSetCookie(page.setCookie).match(/sessionid=([^;]+)/)?.[1]
      const cookie = [cookiesFromSetCookie(page.setCookie), session ? `sessionid=${session}` : '']
        .filter(Boolean)
        .join('; ')
      if (!session) throw new Error('Steam sessionid missing')

      const ajax = await httpGetText(
        `https://steamcommunity.com/search/SearchCommunityAjax?text=${encodeURIComponent(q)}&filter=users&sessionid=${encodeURIComponent(session)}&steamid_user=false&page=1`,
        {
          timeoutMs: 12000,
          cookieJar: cookie,
          headers: {
            Referer: `https://steamcommunity.com/search/users/?text=${encodeURIComponent(q)}`,
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json, text/javascript, */*; q=0.01',
          },
        },
      )
      let data
      try {
        data = JSON.parse(ajax.text)
      } catch {
        throw new Error('Steam search bad JSON')
      }
      const html = String(data.html || '')
      const hits = []
      const blocks = html.split(/class="search_row"/).slice(1)
      for (const block of blocks.slice(0, 12)) {
        const steam64 = block.match(/steamcommunity\.com\/profiles\/(\d{17})/)?.[1]
        const accountId =
          Number(block.match(/data-miniprofile="(\d+)"/)?.[1]) ||
          (steam64 ? Number(BigInt(steam64) - STEAM64_BASE_N) : NaN)
        if (!Number.isFinite(accountId)) continue
        const name = block.match(/searchPersonaName"[^>]*>([^<]*)/)?.[1]?.replace(/&amp;/g, '&').trim()
        let avatar = block.match(/https:\/\/avatars\.[^"']+\.(?:jpg|jpeg|png)/)?.[0]
        if (avatar) avatar = avatar.replace('_medium', '_full')
        hits.push({
          account_id: accountId,
          accountId,
          personaname: name || `Player ${accountId}`,
          avatarfull: avatar,
          source: 'steam',
          profileurl: steam64
            ? `https://steamcommunity.com/profiles/${steam64}`
            : `https://steamcommunity.com/profiles/${BigInt(accountId) + STEAM64_BASE_N}`,
        })
      }
      return hits
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (!/429|timeout/i.test(msg)) break
    }
  }
  throw lastErr || new Error('Steam search failed')
}

/** Best-effort Dotabuff HTML search (often Cloudflare-blocked). */
export async function searchDotabuff(rawNick) {
  const q = nickQueryVariants(rawNick)[0] || String(rawNick || '').trim()
  if (!q) return []
  const page = await httpGetText(`https://www.dotabuff.com/search?q=${encodeURIComponent(q)}&commit=Search`, {
    timeoutMs: 10000,
  })
  if (/just a moment|cf-browser-verification|cloudflare/i.test(page.text)) {
    throw new Error('Dotabuff Cloudflare')
  }
  const hits = []
  const re = /href="\/players\/(\d+)"[^>]*>\s*([^<]{0,80})/gi
  let m
  while ((m = re.exec(page.text)) && hits.length < 12) {
    const accountId = Number(m[1])
    if (!Number.isFinite(accountId)) continue
    hits.push({
      account_id: accountId,
      accountId,
      personaname: m[2].replace(/&amp;/g, '&').trim() || `Player ${accountId}`,
      source: 'dotabuff',
      profileurl: `https://www.dotabuff.com/players/${accountId}`,
    })
  }
  return hits
}

/** Stratz GraphQL search — needs STRATZ_TOKEN env (Bearer). */
export async function searchStratz(rawNick) {
  const token = process.env.STRATZ_TOKEN || process.env.STRATZ_API_KEY || ''
  if (!token) throw new Error('STRATZ_TOKEN not set')
  const q = nickQueryVariants(rawNick)[0] || String(rawNick || '').trim()
  const body = JSON.stringify({
    query: `query Search($term: String!) {
      steamAccounts(request: { steamAccountName: $term, take: 12 }) {
        id
        name
        avatar
      }
    }`,
    variables: { term: q },
  })
  const text = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.stratz.com',
        path: '/graphql',
        method: 'POST',
        family: 4,
        timeout: 12000,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'STRATZ_API',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const t = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Stratz HTTP ${res.statusCode}: ${t.slice(0, 120)}`))
            return
          }
          resolve(t)
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Stratz timeout'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
  const data = JSON.parse(text)
  const rows = data?.data?.steamAccounts || data?.data?.players || []
  return (Array.isArray(rows) ? rows : []).map((p) => {
    const id = Number(p.id || p.steamAccountId)
    return {
      account_id: id,
      accountId: id,
      personaname: p.name || p.personaname || `Player ${id}`,
      avatarfull: p.avatar || p.avatarfull,
      source: 'stratz',
      profileurl: `https://stratz.com/players/${id}`,
    }
  })
}

async function enrichFromOpenDota(hit) {
  try {
    const data = await opendotaGet(`/api/players/${hit.accountId}`, { timeoutMs: 8000, retries: 1 })
    return {
      ...hit,
      personaname: data?.profile?.personaname || hit.personaname,
      avatarfull: data?.profile?.avatarfull || hit.avatarfull,
      profileurl: data?.profile?.profileurl || hit.profileurl,
    }
  } catch {
    return hit
  }
}

function externalSearchLinks(nick) {
  const q = encodeURIComponent(nick)
  return [
    { provider: 'steam', label: 'Steam', url: `https://steamcommunity.com/search/users/?text=${q}` },
    { provider: 'dotabuff', label: 'Dotabuff', url: `https://www.dotabuff.com/search?q=${q}` },
    { provider: 'stratz', label: 'Stratz', url: `https://stratz.com/players?q=${q}` },
    { provider: 'opendota', label: 'OpenDota', url: `https://www.opendota.com/search?q=${q}` },
  ]
}

/** Multi-provider nick search: Steam first (reliable), then OpenDota, Dotabuff/Stratz soft. */
export async function searchNickServer(rawNick) {
  const variants = nickQueryVariants(rawNick)
  const needle = variants[0] || String(rawNick || '').trim()
  if (!needle) return { hits: [], degraded: false, providers: [], links: externalSearchLinks('') }

  const byId = new Map()
  const providers = []
  const hardErrors = []
  const softNotes = []
  let odOk = false

  const addHit = (p, source) => {
    const id = Number(p.accountId ?? p.account_id)
    if (!Number.isFinite(id)) return
    const prev = byId.get(id)
    if (!prev) {
      byId.set(id, {
        account_id: id,
        accountId: id,
        personaname: p.personaname || `Player ${id}`,
        avatarfull: p.avatarfull,
        profileurl: p.profileurl,
        source: source || p.source || 'unknown',
      })
      return
    }
    byId.set(id, {
      ...prev,
      personaname: prev.personaname || p.personaname,
      avatarfull: prev.avatarfull || p.avatarfull,
      profileurl: prev.profileurl || p.profileurl,
      source: prev.source.includes(source) ? prev.source : `${prev.source}+${source}`,
    })
  }

  const isSoftBlock = (msg) =>
    /403|429|cloudflare|just a moment|STRATZ_TOKEN not set|cf-/i.test(String(msg || ''))

  // 1) Steam first — main fallback when OpenDota /search is dead
  try {
    const steamHits = await searchSteamCommunity(needle)
    if (steamHits.length) {
      providers.push('steam')
      for (const p of steamHits) addHit(p, 'steam')
    } else {
      softNotes.push('steam: no results')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isSoftBlock(msg)) softNotes.push(`steam: ${msg}`)
    else hardErrors.push(`steam: ${msg}`)
  }

  // 2) OpenDota + Dotabuff + Stratz in parallel
  await Promise.all([
    (async () => {
      try {
        const data = await opendotaGet(`/api/search?q=${encodeURIComponent(needle)}`, {
          timeoutMs: 7000,
          retries: 1,
        })
        odOk = true
        providers.push('opendota')
        for (const p of Array.isArray(data) ? data : []) {
          addHit(
            {
              account_id: p.account_id,
              accountId: p.account_id,
              personaname: p.personaname,
              avatarfull: p.avatarfull,
            },
            'opendota',
          )
        }
      } catch (e) {
        hardErrors.push(`opendota: ${e instanceof Error ? e.message : String(e)}`)
      }
    })(),
    (async () => {
      try {
        const hits = await searchDotabuff(needle)
        if (hits.length) {
          providers.push('dotabuff')
          for (const p of hits) addHit(p, 'dotabuff')
        }
      } catch (e) {
        // Dotabuff is almost always Cloudflare — never treat as primary failure
        softNotes.push(`dotabuff: ${e instanceof Error ? e.message : String(e)}`)
      }
    })(),
    (async () => {
      try {
        const hits = await searchStratz(needle)
        if (hits.length) {
          providers.push('stratz')
          for (const p of hits) addHit(p, 'stratz')
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!/STRATZ_TOKEN not set/i.test(msg)) softNotes.push(`stratz: ${msg}`)
      }
    })(),
  ])

  let hits = [...byId.values()]
  if (hits.length && !odOk) {
    hits = await Promise.all(hits.slice(0, 8).map((h) => enrichFromOpenDota(h)))
  }

  hits = hits
    .map((p) => ({ ...p, _score: nickScore(p.personaname, needle) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 16)
    .map(({ _score, ...rest }) => rest)

  const degraded = hits.length === 0
  const primary = hardErrors.length ? hardErrors.join(' · ') : softNotes.filter((n) => !/dotabuff/i.test(n)).join(' · ')
  return {
    hits,
    degraded,
    providers,
    errors: [...hardErrors, ...softNotes],
    links: externalSearchLinks(needle),
    error: degraded
      ? primary || softNotes[0] || 'Ник не найден ни в Steam, ни в OpenDota'
      : undefined,
  }
}

// silence unused import lint if any bundler looks here
void http
