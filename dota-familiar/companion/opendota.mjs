import https from 'node:https'
import http from 'node:http'

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
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ReplayFace-Companion/1.1',
          },
          timeout: timeoutMs,
        },
        (res) => {
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
            } catch (e) {
              reject(new Error(`OpenDota bad JSON: ${text.slice(0, 120)}`))
            }
          })
        },
      )
      req.on('timeout', () => {
        req.destroy()
        reject(new Error(`OpenDota timeout after ${timeoutMs}ms`))
      })
      req.on('error', reject)
    })

  return (async () => {
    let last
    for (let i = 0; i < retries; i++) {
      try {
        return await once()
      } catch (e) {
        last = e
        await new Promise((r) => setTimeout(r, 600 * (i + 1)))
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
    opendotaGet(`/api/players/${accountId}`),
    opendotaGet(`/api/players/${accountId}/wl`).catch(() => ({ win: 0, lose: 0 })),
    opendotaGet(`/api/players/${accountId}/matches?limit=${matchLimit}`),
  ])

  const players = {}
  const total = recent.length
  let done = 0

  for (const m of recent) {
    try {
      const detail = await opendotaGet(`/api/matches/${m.match_id}`, { timeoutMs: 25000, retries: 2 })
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
    } catch {
      // skip broken match
    }
    done += 1
    onProgress?.(done, total)
    await new Promise((r) => setTimeout(r, 150))
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

// silence unused import lint if any bundler looks here
void http
