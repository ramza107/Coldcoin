import type { FamiliarIndex } from '../types'

const KEY = 'dota-familiar:index:v1'
const ACCOUNT_KEY = 'dota-familiar:account:v1'

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
