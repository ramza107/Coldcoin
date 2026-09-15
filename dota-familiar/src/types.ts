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

export interface RecentMatchBrief {
  matchId: number
  heroId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  startTime: number
  duration?: number
  lobbyType?: number
}

export interface CheckedPlayer extends MatchPlayer {
  familiar?: FamiliarRecord
  profile?: PlayerProfile | null
  recentMatches?: RecentMatchBrief[]
  role?: 'enemy' | 'ally' | 'you'
  rank?: number | null
  medalName?: string
  medalStars?: number | null
  slotIndex?: number | null
  hero?: string
}

export interface LiveLobbyPlayer {
  accountId: AccountId | null
  personaname?: string
  heroId: number
  hero?: string
  team: 'radiant' | 'dire'
  steamId?: string
  isOwner?: boolean
  /** Competitive rank number from Overwolf (when IDs are still hidden). */
  rank?: number | null
  medalName?: string
  medalStars?: number | null
  slotIndex?: number | null
}

export interface LiveLobby {
  source: string
  updatedAt: number
  matchStartedAt?: number | null
  matchId?: number | null
  gameState?: string | null
  myTeam: 'radiant' | 'dire'
  players: LiveLobbyPlayer[]
  enemies: LiveLobbyPlayer[]
  allies: LiveLobbyPlayer[]
  /** True while Valve still hides Steam IDs (connect / hero select). */
  awaitingRoster?: boolean
  /** True when we have slots/ranks but not account IDs yet. */
  awaitingIds?: boolean
  phase?: 'connecting' | 'draft' | 'strategy' | 'live' | 'unknown'
}

export interface CompanionLobbyResponse {
  lobby: LiveLobby | null
  companion: boolean
  lastGsiAt?: number | null
  gameState?: string | null
}
