import type { CompanionLobbyResponse, LiveLobby } from '../types'
import { DEFAULT_COMPANION_URL } from './storage'

export async function fetchCompanionLobby(
  baseUrl = DEFAULT_COMPANION_URL,
): Promise<CompanionLobbyResponse | null> {
  const root = baseUrl.replace(/\/$/, '')
  try {
    const res = await fetch(`${root}/lobby`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as CompanionLobbyResponse
  } catch {
    return null
  }
}

export async function fetchCompanionHealth(baseUrl = DEFAULT_COMPANION_URL): Promise<boolean> {
  const root = baseUrl.replace(/\/$/, '')
  try {
    const res = await fetch(`${root}/health`, { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchOcrNicks(
  baseUrl = DEFAULT_COMPANION_URL,
  opts?: { delayMs?: number },
): Promise<{
  ok: boolean
  nicks?: string[]
  engine?: string
  rawText?: string
  hint?: string
  error?: string
  errors?: string[]
  meta?: string
}> {
  const root = baseUrl.replace(/\/$/, '')
  const res = await fetch(`${root}/ocr-nicks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delayMs: opts?.delayMs ?? 1500, heightPx: 120, scale: 3 }),
  })
  const data = (await res.json()) as {
    ok?: boolean
    nicks?: string[]
    engine?: string
    rawText?: string
    hint?: string
    error?: string
    errors?: string[]
    meta?: string
  }
  if (!res.ok) {
    return { ok: false, error: data.error || `ocr-nicks ${res.status}`, hint: data.hint, rawText: data.rawText }
  }
  return {
    ok: Boolean(data.ok !== false),
    nicks: data.nicks || [],
    engine: data.engine,
    rawText: data.rawText,
    hint: data.hint,
    error: data.error,
    errors: data.errors,
    meta: data.meta,
  }
}

export function lobbySignature(lobby: LiveLobby | null): string {
  if (!lobby) return ''
  return [
    lobby.source,
    lobby.matchId ?? '',
    lobby.myTeam,
    lobby.phase ?? '',
    lobby.awaitingRoster ? '1' : '0',
    lobby.awaitingIds ? '1' : '0',
    lobby.players
      .map(
        (p) =>
          `${p.accountId}:${p.heroId}:${p.hero || ''}:${p.team}:${p.rank ?? ''}:${p.medalName || ''}`,
      )
      .join(','),
  ].join('|')
}
