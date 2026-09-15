import type { FamiliarIndex } from '../types'

const KEY = 'dota-familiar:index:v1'
const ACCOUNT_KEY = 'dota-familiar:account:v1'
const WATCH_KEY = 'dota-familiar:watch:v1'
const LAST_MATCH_KEY = 'dota-familiar:last-match:v1'
const LIVE_LISTEN_KEY = 'dota-familiar:live-listen:v1'
const COMPANION_URL_KEY = 'dota-familiar:companion-url:v1'

export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:17321'

export function loadIndex(): FamiliarIndex | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as FamiliarIndex) : null
  } catch {
    return null
  }
}

export function saveIndex(index: FamiliarIndex) {
  localStorage.setItem(KEY, JSON.stringify(index))
}

export function clearIndex() {
  localStorage.removeItem(KEY)
}

export function loadSavedAccount(): string {
  return localStorage.getItem(ACCOUNT_KEY) || ''
}

export function saveAccountInput(value: string) {
  localStorage.setItem(ACCOUNT_KEY, value)
}

export function loadWatchEnabled(): boolean {
  return localStorage.getItem(WATCH_KEY) === '1'
}

export function saveWatchEnabled(on: boolean) {
  localStorage.setItem(WATCH_KEY, on ? '1' : '0')
}

export function loadLastMatchId(): number | null {
  const raw = localStorage.getItem(LAST_MATCH_KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function saveLastMatchId(matchId: number) {
  localStorage.setItem(LAST_MATCH_KEY, String(matchId))
}

export function loadLiveListen(): boolean {
  return localStorage.getItem(LIVE_LISTEN_KEY) !== '0'
}

export function saveLiveListen(on: boolean) {
  localStorage.setItem(LIVE_LISTEN_KEY, on ? '1' : '0')
}

export function loadCompanionUrl(): string {
  return localStorage.getItem(COMPANION_URL_KEY) || DEFAULT_COMPANION_URL
}

export function saveCompanionUrl(url: string) {
  localStorage.setItem(COMPANION_URL_KEY, url)
}
