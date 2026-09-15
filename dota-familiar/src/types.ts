export type AccountId = number

export interface PlayerProfile {
  accountId: AccountId
  personaname: string
  avatarfull?: string
  profileurl?: string
  rankTier?: number | null
  leaderboardRank?: number | null
  wins?: number
  losses?: number
}

export interface FamiliarRecord {
  accountId: AccountId
  personaname: string
  avatar?: string
  games: number
  asAlly: number
  asEnemy: number
  winsWith: number
  winsAgainst: number
  lastMatchId: number
  lastPlayedAt: number
}

export interface FamiliarIndex {
  ownerAccountId: AccountId
  ownerName: string
  ownerAvatar?: string
  syncedAt: number
  matchesScanned: number
  players: Record<string, FamiliarRecord>
}

export interface MatchPlayer {
  accountId: AccountId | null
  personaname?: string
  heroId: number
  team: 'radiant' | 'dire'
  win?: boolean
  isOwner?: boolean
  kills?: number
  deaths?: number
  assists?: number
  netWorth?: number
  gpm?: number
  xpm?: number
  level?: number
}

export interface CheckedPlayer extends MatchPlayer {
  familiar?: FamiliarRecord
  profile?: PlayerProfile | null
}
