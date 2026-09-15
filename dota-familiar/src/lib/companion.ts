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

export function lobbySignature(lobby: LiveLobby | null): string {
  if (!lobby) return ''
  return [
    lobby.updatedAt,
    lobby.myTeam,
    lobby.players.map((p) => `${p.accountId}:${p.heroId}:${p.team}`).join(','),
  ].join('|')
}
