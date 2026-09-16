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

/** Fast multi-variant OpenDota nick search for live lobby. */
export async function searchNickServer(rawNick) {
  const variants = nickQueryVariants(rawNick)
  const needle = variants[0] || String(rawNick || '').trim()
  if (!needle) return []
  const byId = new Map()
  await Promise.all(
    variants.map(async (v) => {
      try {
        const data = await opendotaGet(`/api/search?q=${encodeURIComponent(v)}`, {
          timeoutMs: 8000,
          retries: 1,
        })
        for (const p of Array.isArray(data) ? data : []) {
          const id = Number(p.account_id)
          if (!Number.isFinite(id) || byId.has(id)) continue
          byId.set(id, {
            account_id: id,
            accountId: id,
            personaname: p.personaname || `Player ${id}`,
            avatarfull: p.avatarfull,
          })
        }
      } catch {
        // ignore variant failure
      }
    }),
  )
  return [...byId.values()]
    .map((p) => ({ ...p, _score: nickScore(p.personaname, needle) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 16)
    .map(({ _score, ...rest }) => rest)
}

// silence unused import lint if any bundler looks here
void http
