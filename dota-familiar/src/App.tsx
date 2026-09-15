import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchCompanionHealth, fetchCompanionLobby, lobbySignature } from './lib/companion'
import {
  absorbMatchIntoIndex,
  accountIdToSteam64,
  buildFamiliarIndex,
  fetchLatestMatchId,
  fetchMatch,
  fetchPlayer,
  fetchPlayerRecentBrief,
  matchPlayersFromDetail,
  rankLabel,
  resolveAccountId,
  steam64ToAccountId,
  winrate,
} from './lib/opendota'
import {
  clearIndex,
  DEFAULT_COMPANION_URL,
  loadCompanionUrl,
  loadIndex,
  loadLastMatchId,
  loadLiveListen,
  loadSavedAccount,
  loadWatchEnabled,
  saveAccountInput,
  saveCompanionUrl,
  saveIndex,
  saveLastMatchId,
  saveLiveListen,
  saveWatchEnabled,
} from './lib/storage'
import type {
  CheckedPlayer,
  FamiliarIndex,
  FamiliarRecord,
  LiveLobby,
  LiveLobbyPlayer,
  RecentMatchBrief,
} from './types'
import './App.css'

type Tab = 'live' | 'history' | 'familiar' | 'sync'

function formatAgo(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return `${Math.floor(diff / (86400 * 30))}mo ago`
}

function FamiliarBadge({ rec }: { rec: FamiliarRecord }) {
  const kind = rec.asAlly >= rec.asEnemy ? 'ally' : 'enemy'
  return (
    <span className={`badge ${kind}`}>
      Played before · {rec.games}x
      <small>
        {rec.asAlly ? `${rec.asAlly} ally` : ''}
        {rec.asAlly && rec.asEnemy ? ' · ' : ''}
        {rec.asEnemy ? `${rec.asEnemy} enemy` : ''}
        {' · '}
        {formatAgo(rec.lastPlayedAt)}
      </small>
    </span>
  )
}

function RecentStrip({ matches }: { matches?: RecentMatchBrief[] }) {
  if (!matches?.length) return null
  const wins = matches.filter((m) => m.win).length
  return (
    <div className="recent-strip">
      <em>Last {matches.length} matches · {wins}W-{matches.length - wins}L</em>
      <ul>
        {matches.map((m) => (
          <li key={m.matchId} className={m.win ? 'w' : 'l'} title={`Hero #${m.heroId}`}>
            <span className="outcome">{m.win ? 'W' : 'L'}</span>
            <span>
              #{m.heroId} · {m.kills}/{m.deaths}/{m.assists}
            </span>
            <span className="ago">{formatAgo(m.startTime)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

async function enrichMatch(detail: Awaited<ReturnType<typeof fetchMatch>>, index: FamiliarIndex) {
  const rows = matchPlayersFromDetail(detail, index.ownerAccountId)
  const enriched: CheckedPlayer[] = []
  for (const row of rows) {
    const familiar = row.accountId ? index.players[String(row.accountId)] : undefined
    let profile = null
    if (row.accountId) {
      try {
        profile = await fetchPlayer(row.accountId)
      } catch {
        profile = null
      }
    }
    enriched.push({
      ...row,
      familiar,
      profile,
      role: row.isOwner ? 'you' : row.team === rows.find((r) => r.isOwner)?.team ? 'ally' : 'enemy',
    })
  }
  return enriched
}

async function enrichLobbyPlayers(
  players: LiveLobbyPlayer[],
  myTeam: 'radiant' | 'dire',
  index: FamiliarIndex,
  withRecent: boolean,
): Promise<CheckedPlayer[]> {
  const out: CheckedPlayer[] = []
  for (const p of players) {
    const isOwner = Boolean(p.isOwner) || p.accountId === index.ownerAccountId
    const role: CheckedPlayer['role'] = isOwner ? 'you' : p.team === myTeam ? 'ally' : 'enemy'
    const familiar = p.accountId && !isOwner ? index.players[String(p.accountId)] : undefined
    let profile = null
    let recentMatches: RecentMatchBrief[] | undefined
    if (p.accountId) {
      try {
        profile = await fetchPlayer(p.accountId)
      } catch {
        profile = null
      }
      if (withRecent && role === 'enemy') {
        try {
          recentMatches = await fetchPlayerRecentBrief(p.accountId, 5)
        } catch {
          recentMatches = undefined
        }
      }
    }
    out.push({
      accountId: p.accountId,
      personaname: p.personaname || profile?.personaname,
      heroId: p.heroId,
      hero: p.hero,
      team: p.team,
      isOwner,
      familiar,
      profile,
      recentMatches,
      role,
      rank: p.rank,
      medalName: p.medalName,
      medalStars: p.medalStars,
      slotIndex: p.slotIndex,
    })
  }
  return out
}

function parseEnemyPaste(raw: string, myTeam: 'radiant' | 'dire'): LiveLobbyPlayer[] {
  const enemyTeam = myTeam === 'radiant' ? 'dire' : 'radiant'
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const players: LiveLobbyPlayer[] = []
  for (const token of tokens) {
    try {
      let accountId: number | null = null
      const od = token.match(/opendota\.com\/players\/(\d+)/i)
      const st = token.match(/profiles\/(\d{17})/i)
      if (od) accountId = Number(od[1])
      else if (st) accountId = steam64ToAccountId(st[1])
      else if (/^\d{17}$/.test(token)) accountId = steam64ToAccountId(token)
      else if (/^\d{3,12}$/.test(token)) accountId = Number(token)
      if (accountId) {
        players.push({ accountId, heroId: 0, team: enemyTeam })
      }
    } catch {
      // skip bad token
    }
  }
  return players
}

export default function App() {
  const [accountInput, setAccountInput] = useState(loadSavedAccount())
  const [index, setIndex] = useState<FamiliarIndex | null>(null)
  const [tab, setTab] = useState<Tab>('sync')
  const [checked, setChecked] = useState<CheckedPlayer[]>([])
  const [livePlayers, setLivePlayers] = useState<CheckedPlayer[]>([])
  const [lobby, setLobby] = useState<LiveLobby | null>(null)
  const [activeMatchId, setActiveMatchId] = useState<number | null>(loadLastMatchId())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [matchLimit, setMatchLimit] = useState(30)
  const [watch, setWatch] = useState(loadWatchEnabled())
  const [liveListen, setLiveListen] = useState(loadLiveListen())
  const [companionUrl, setCompanionUrl] = useState(loadCompanionUrl())
  const [companionOnline, setCompanionOnline] = useState(false)
  const [enemyPaste, setEnemyPaste] = useState('')
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null)
  const indexRef = useRef<FamiliarIndex | null>(null)
  const bootRef = useRef(false)
  const lobbySigRef = useRef('')
  const pendingLobbyRef = useRef<LiveLobby | null>(null)
  const enrichingRef = useRef(false)

  useEffect(() => {
    indexRef.current = index
  }, [index])

  const applyLobby = useCallback(async (next: LiveLobby, current: FamiliarIndex) => {
    const sig = lobbySignature(next)
    if (sig === lobbySigRef.current) return
    if (enrichingRef.current) {
      pendingLobbyRef.current = next
      return
    }
    enrichingRef.current = true
    lobbySigRef.current = sig
    setLobby(next)
    try {
      const enriched = await enrichLobbyPlayers(next.players, next.myTeam, current, true)
      setLivePlayers(enriched)
      const enemyFamiliar = enriched.filter((p) => p.role === 'enemy' && p.familiar).length
      const enemyTotal = enriched.filter((p) => p.role === 'enemy').length
      setStatus(
        next.awaitingIds || next.awaitingRoster
          ? `Match ${next.phase || 'live'} · Valve hides Steam IDs until after picks — showing ranks/slots now`
          : `Live lobby · ${enemyTotal} enemies · ${enemyFamiliar} familiar`,
      )
      setTab('live')
      setLastCheckedAt(Date.now())
    } finally {
      enrichingRef.current = false
      const pending = pendingLobbyRef.current
      pendingLobbyRef.current = null
      if (pending && lobbySignature(pending) !== lobbySigRef.current) {
        void applyLobby(pending, indexRef.current || current)
      }
    }
  }, [])

  const loadMatchById = useCallback(async (matchId: number, current: FamiliarIndex, absorbNew: boolean) => {
    const previousId = loadLastMatchId()
    const detail = await fetchMatch(matchId)
    const enriched = await enrichMatch(detail, current)
    setChecked(enriched)
    setActiveMatchId(matchId)
    setLastCheckedAt(Date.now())

    if (absorbNew && previousId != null && previousId !== matchId) {
      const next = absorbMatchIntoIndex(current, detail)
      saveIndex(next)
      setIndex(next)
      indexRef.current = next
    }

    saveLastMatchId(matchId)
    const familiarCount = enriched.filter((p) => p.familiar && !p.isOwner).length
    return { matchId, familiarCount, isNew: previousId !== matchId }
  }, [])

  const pullLatest = useCallback(
    async (current: FamiliarIndex, absorbNew = true) => {
      setError('')
      const latestId = await fetchLatestMatchId(current.ownerAccountId)
      if (!latestId) {
        setStatus('No matches found on this account yet')
        return null
      }
      const result = await loadMatchById(latestId, current, absorbNew)
      setStatus(
        result.isNew
          ? `Finished match ${result.matchId} · ${result.familiarCount} familiar`
          : `Latest finished match ${result.matchId} · ${result.familiarCount} familiar`,
      )
      return result
    },
    [loadMatchById],
  )

  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    const saved = loadIndex()
    if (!saved) return
    setIndex(saved)
    setTab('live')
    void (async () => {
      try {
        setBusy(true)
        setStatus('Ready for live lobby — companion listens for match start')
      } finally {
        setBusy(false)
      }
    })()
  }, [])

  // Poll local companion for live enemies when a match starts
  useEffect(() => {
    if (!liveListen || !index) return
    let cancelled = false

    const tick = async () => {
      const current = indexRef.current
      if (!current) return
      const online = await fetchCompanionHealth(companionUrl)
      if (cancelled) return
      setCompanionOnline(online)
      if (!online) return
      const data = await fetchCompanionLobby(companionUrl)
      if (cancelled || !data?.lobby) return
      await applyLobby(data.lobby, current)
    }

    void tick()
    const id = window.setInterval(() => void tick(), 2500)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [liveListen, index, companionUrl, applyLobby])

  useEffect(() => {
    if (!watch || !index) return
    const tick = async () => {
      const current = indexRef.current
      if (!current) return
      try {
        const latestId = await fetchLatestMatchId(current.ownerAccountId)
        if (!latestId || latestId === loadLastMatchId()) return
        setBusy(true)
        const result = await loadMatchById(latestId, current, true)
        setStatus(`New finished match: ${result.matchId} · ${result.familiarCount} familiar`)
      } catch {
        // keep polling
      } finally {
        setBusy(false)
      }
    }
    const id = window.setInterval(() => void tick(), 45000)
    return () => window.clearInterval(id)
  }, [watch, index, loadMatchById])

  const familiarList = useMemo(() => {
    if (!index) return []
    return Object.values(index.players).sort((a, b) => b.games - a.games || b.lastPlayedAt - a.lastPlayedAt)
  }, [index])

  const filteredFamiliar = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return familiarList
    return familiarList.filter(
      (p) => p.personaname.toLowerCase().includes(q) || String(p.accountId).includes(q),
    )
  }, [familiarList, query])

  async function handleConnectAndSync() {
    setError('')
    setStatus('')
    setBusy(true)
    try {
      saveAccountInput(accountInput)
      setStatus('Resolving account…')
      const accountId = await resolveAccountId(accountInput)
      setStatus('Loading profile & match history…')
      const built = await buildFamiliarIndex(accountId, matchLimit, (done, total) => {
        setProgress({ done, total })
        setStatus(`Scanning matches ${done}/${total}…`)
      })
      saveIndex(built)
      setIndex(built)
      indexRef.current = built
      setTab('live')
      setLiveListen(true)
      saveLiveListen(true)
      setWatch(true)
      saveWatchEnabled(true)
      setStatus(
        `Synced ${built.matchesScanned} matches · start companion + Dota; enemies appear when the match starts`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRefreshLatest() {
    if (!index) return
    setBusy(true)
    try {
      await pullLatest(index, true)
      setTab('history')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleLoadDemoLobby() {
    if (!index) return
    setBusy(true)
    setError('')
    try {
      // Prefer whatever companion already has; else push sample-like roster from familiar list
      const data = await fetchCompanionLobby(companionUrl)
      if (data?.lobby?.players?.length) {
        lobbySigRef.current = ''
        await applyLobby(data.lobby, index)
        return
      }
      const familiar = Object.values(index.players).slice(0, 2)
      const enemies = familiar.map((p, i) => ({
        accountId: p.accountId,
        personaname: p.personaname,
        heroId: [44, 5][i] || 1,
        team: 'dire' as const,
      }))
      const next = {
        source: 'demo',
        updatedAt: Date.now(),
        matchStartedAt: Date.now(),
        gameState: 'DOTA_GAMERULES_STATE_PRE_GAME',
        phase: 'live' as const,
        myTeam: 'radiant' as const,
        players: [
          {
            accountId: index.ownerAccountId,
            personaname: index.ownerName,
            heroId: 1,
            team: 'radiant' as const,
            isOwner: true,
          },
          ...enemies,
        ],
        enemies,
        allies: [
          {
            accountId: index.ownerAccountId,
            personaname: index.ownerName,
            heroId: 1,
            team: 'radiant' as const,
            isOwner: true,
          },
        ],
        awaitingRoster: false,
        awaitingIds: false,
      }
      try {
        await fetch(`${companionUrl.replace(/\/$/, '')}/lobby`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
      } catch {
        // optional
      }
      lobbySigRef.current = ''
      await applyLobby(next, index)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Demo lobby failed')
    } finally {
      setBusy(false)
    }
  }

  async function handlePasteEnemies() {
    if (!index) return
    setError('')
    setBusy(true)
    try {
      const myTeam = lobby?.myTeam || 'radiant'
      let enemies = parseEnemyPaste(enemyPaste, myTeam)
      if (!enemies.length) {
        const one = enemyPaste.trim()
        if (one) {
          const id = await resolveAccountId(one)
          enemies = [{ accountId: id, heroId: 0, team: myTeam === 'radiant' ? 'dire' : 'radiant' }]
        }
      }
      if (!enemies.length) throw new Error('Paste enemy account IDs, Steam64, or OpenDota links')

      const me: LiveLobbyPlayer = {
        accountId: index.ownerAccountId,
        personaname: index.ownerName,
        heroId: 0,
        team: myTeam,
        isOwner: true,
      }
      const next: LiveLobby = {
        source: 'paste',
        updatedAt: Date.now(),
        matchStartedAt: Date.now(),
        myTeam,
        players: [me, ...enemies],
        enemies,
        allies: [me],
        awaitingRoster: false,
      }
      lobbySigRef.current = ''
      await applyLobby(next, index)

      // also push to companion if online
      try {
        await fetch(`${companionUrl.replace(/\/$/, '')}/lobby`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
      } catch {
        // optional
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load enemies')
    } finally {
      setBusy(false)
    }
  }

  function toggleWatch() {
    const next = !watch
    setWatch(next)
    saveWatchEnabled(next)
    setStatus(next ? 'Post-game auto-watch ON' : 'Post-game auto-watch OFF')
  }

  function toggleLiveListen() {
    const next = !liveListen
    setLiveListen(next)
    saveLiveListen(next)
    setStatus(next ? 'Listening for live lobby on companion…' : 'Live listen OFF')
  }

  function handleReset() {
    clearIndex()
    localStorage.removeItem('dota-familiar:last-match:v1')
    setIndex(null)
    setChecked([])
    setLivePlayers([])
    setLobby(null)
    setActiveMatchId(null)
    lobbySigRef.current = ''
    pendingLobbyRef.current = null
    setWatch(false)
    saveWatchEnabled(false)
    setTab('sync')
    setStatus('Cleared local data')
    void fetch(`${companionUrl.replace(/\/$/, '')}/lobby`, { method: 'DELETE' }).catch(() => {})
  }

  const liveEnemies = livePlayers.filter((p) => p.role === 'enemy')
  const liveAllies = livePlayers.filter((p) => p.role === 'ally' || p.role === 'you')
  const familiarEnemies = liveEnemies.filter((p) => p.familiar).length

  const radiant = checked.filter((p) => p.team === 'radiant')
  const dire = checked.filter((p) => p.team === 'dire')
  const familiarInMatch = checked.filter((p) => p.familiar && !p.isOwner).length

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />
      <header className="topbar">
        <div className="brand">
          <span className="mark">RF</span>
          <div>
            <strong>ReplayFace</strong>
            <em>Enemy radar at match start</em>
          </div>
        </div>
        {index && (
          <div className="owner">
            {index.ownerAvatar && <img src={index.ownerAvatar} alt="" />}
            <div>
              <b>{index.ownerName}</b>
              <span>{Object.keys(index.players).length} remembered</span>
            </div>
          </div>
        )}
      </header>

      <main className="shell">
        <section className="hero">
          <p className="eyebrow">When the game starts</p>
          <h1>Know the enemies</h1>
          <p className="lede">
            OpenDota already has stats on almost everyone — but it does not know who is in{' '}
            <em>your</em> live lobby. Companion reads enemy Steam IDs from Dota after picks; ReplayFace looks them up
            and flags who you already faced.
          </p>
        </section>

        <nav className="tabs">
          <button type="button" className={tab === 'sync' ? 'on' : ''} onClick={() => setTab('sync')}>
            Connect
          </button>
          <button
            type="button"
            className={tab === 'live' ? 'on' : ''}
            onClick={() => setTab('live')}
            disabled={!index}
          >
            Live lobby
          </button>
          <button
            type="button"
            className={tab === 'history' ? 'on' : ''}
            onClick={() => setTab('history')}
            disabled={!index}
          >
            Last finished
          </button>
          <button
            type="button"
            className={tab === 'familiar' ? 'on' : ''}
            onClick={() => setTab('familiar')}
            disabled={!index}
          >
            Familiar list
          </button>
        </nav>

        {error && <div className="banner error">{error}</div>}
        {status && !error && <div className="banner ok">{status}</div>}

        {tab === 'sync' && (
          <section className="panel">
            <h2>Connect once</h2>
            <p className="help">
              Builds your familiar index from OpenDota. At match start the companion only needs enemy Steam IDs — ranks,
              WR, and recent games come from OpenDota right away.
            </p>
            <label className="field">
              <span>Your profile</span>
              <input
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                placeholder="OpenDota / Steam URL or account ID"
                disabled={busy}
              />
            </label>
            <label className="field inline">
              <span>History depth</span>
              <select
                value={matchLimit}
                onChange={(e) => setMatchLimit(Number(e.target.value))}
                disabled={busy}
              >
                <option value={20}>20 matches</option>
                <option value={30}>30 matches</option>
                <option value={50}>50 matches</option>
                <option value={80}>80 matches</option>
              </select>
            </label>
            {busy && progress.total > 0 && (
              <div className="progress">
                <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={busy || !accountInput.trim()}
                onClick={handleConnectAndSync}
              >
                {busy ? 'Working…' : index ? 'Re-sync history' : 'Connect & sync'}
              </button>
              {index && (
                <button type="button" className="ghost" disabled={busy} onClick={handleReset}>
                  Reset
                </button>
              )}
            </div>
            <p className="fineprint">
              Flow: Dota → Overwolf app (`overwolf-app/`) after picks → companion → OpenDota lookup. Run{' '}
              <code>npm run companion</code>, add <code>-gamestateintegration</code>. Paste works without Overwolf.
            </p>
          </section>
        )}

        {tab === 'live' && index && (
          <section className="panel">
            <div className="row spread">
              <div>
                <h2>Live lobby — enemies</h2>
                <p className="help" style={{ marginBottom: 0 }}>
                  {lobby ? (
                    <>
                      Source {lobby.source}
                      {lobby.gameState ? ` · ${lobby.gameState}` : ''}
                      {lastCheckedAt ? ` · ${new Date(lastCheckedAt).toLocaleTimeString()}` : ''}
                      {familiarEnemies ? ` · ${familiarEnemies} familiar enemies` : ''}
                    </>
                  ) : (
                    'No live Steam IDs yet — start a match with companion, or paste enemy IDs (OpenDota has the rest)'
                  )}
                </p>
              </div>
              <div className="row">
                <button
                  type="button"
                  className={liveListen ? 'primary' : 'ghost'}
                  disabled={busy}
                  onClick={toggleLiveListen}
                >
                  {liveListen ? 'Listening ON' : 'Listening OFF'}
                </button>
                <button type="button" className="ghost" disabled={busy || !companionOnline} onClick={handleLoadDemoLobby}>
                  {busy ? 'Loading…' : 'Load current / demo lobby'}
                </button>
              </div>
            </div>

            <div className={`companion-pill ${companionOnline ? 'up' : 'down'}`}>
              Companion {companionOnline ? 'online' : 'offline'} · {companionUrl}
            </div>

            {!companionOnline && (
              <div className="banner error">
                Live game needs the local companion. GitHub Pages cannot read localhost.
                <br />
                On your PC: <code>npm run build && npm run companion</code> then open{' '}
                <code>http://127.0.0.1:17321/</code> (this UI served locally).
              </div>
            )}

            {companionOnline && !lobby && (
              <div className="banner ok">
                Companion online — waiting for Dota/Overwolf to push the current lobby. Start a match or click “Load
                demo lobby”.
              </div>
            )}

            <label className="field">
              <span>Companion URL</span>
              <input
                value={companionUrl}
                onChange={(e) => {
                  setCompanionUrl(e.target.value)
                  saveCompanionUrl(e.target.value || DEFAULT_COMPANION_URL)
                }}
                placeholder={DEFAULT_COMPANION_URL}
              />
            </label>

            {lobby?.awaitingIds && (
              <div className="banner ok">
                Connect/draft phase: ranks & medals can appear, but Steam IDs (familiar + OpenDota history) only after
                picks end (<code>STRATEGY_TIME</code>) — Valve rule, same for every Overwolf app.
              </div>
            )}
            {lobby?.awaitingRoster && !lobby?.awaitingIds && (
              <div className="banner ok">
                Match detected. Waiting for full enemy roster…
              </div>
            )}

            {liveEnemies.length > 0 ? (
              <div className="enemy-focus">
                <h3>{lobby?.awaitingIds ? 'Enemy slots (pre-ID)' : 'Enemies now'}</h3>
                <PlayerList players={liveEnemies} showRecent={!lobby?.awaitingIds} />
              </div>
            ) : (
              <p className="help" style={{ marginTop: '0.8rem' }}>
                {lobby?.phase === 'connecting'
                  ? 'Connected to match — waiting for roster slots from Overwolf…'
                  : 'No enemies yet. Start a match with companion + Overwolf, or paste IDs.'}
              </p>
            )}

            {liveAllies.length > 0 && (
              <div className="ally-block">
                <h3>Your side</h3>
                <PlayerList players={liveAllies} />
              </div>
            )}

            <div className="paste-box">
              <h3>Paste enemies</h3>
              <p className="help">
                Account IDs, Steam64, or OpenDota links — one per line or comma-separated. Use this if Overwolf is not
                set up yet.
              </p>
              <textarea
                value={enemyPaste}
                onChange={(e) => setEnemyPaste(e.target.value)}
                placeholder={'86745912\nhttps://www.opendota.com/players/…'}
                rows={3}
                disabled={busy}
              />
              <button type="button" className="primary" disabled={busy || !enemyPaste.trim()} onClick={handlePasteEnemies}>
                {busy ? 'Loading…' : 'Load enemy intel'}
              </button>
            </div>
          </section>
        )}

        {tab === 'history' && index && (
          <section className="panel">
            <div className="row spread">
              <div>
                <h2>Last finished match</h2>
                <p className="help" style={{ marginBottom: 0 }}>
                  {activeMatchId ? (
                    <>
                      Match{' '}
                      <a
                        href={`https://www.opendota.com/matches/${activeMatchId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {activeMatchId}
                      </a>
                      {familiarInMatch ? ` · ${familiarInMatch} familiar` : ''}
                    </>
                  ) : (
                    'Pull a finished match from OpenDota'
                  )}
                </p>
              </div>
              <div className="row">
                <button type="button" className={watch ? 'primary' : 'ghost'} disabled={busy} onClick={toggleWatch}>
                  {watch ? 'Auto-watch ON' : 'Auto-watch OFF'}
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={handleRefreshLatest}>
                  {busy ? 'Pulling…' : 'Refresh now'}
                </button>
              </div>
            </div>

            {checked.length > 0 ? (
              <div className="teams">
                <TeamBlock title="Radiant" players={radiant} />
                <TeamBlock title="Dire" players={dire} />
              </div>
            ) : (
              <p className="help" style={{ marginTop: '1rem' }}>
                No finished match loaded yet.
              </p>
            )}
          </section>
        )}

        {tab === 'familiar' && index && (
          <section className="panel">
            <div className="row spread">
              <h2>Familiar players</h2>
              <input
                className="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name or ID"
              />
            </div>
            <div className="list">
              {filteredFamiliar.map((p) => (
                <article key={p.accountId} className="person">
                  <div className="person-main">
                    <b>{p.personaname}</b>
                    <span className="id">ID {p.accountId}</span>
                  </div>
                  <FamiliarBadge rec={p} />
                  <div className="person-meta">
                    <span>
                      With you: {p.winsWith}/{p.asAlly || 0}
                    </span>
                    <span>
                      Against you wins: {p.winsAgainst}/{p.asEnemy || 0}
                    </span>
                  </div>
                  <div className="links">
                    <a href={`https://www.opendota.com/players/${p.accountId}`} target="_blank" rel="noreferrer">
                      OpenDota
                    </a>
                    <a href={`https://www.dotabuff.com/players/${p.accountId}`} target="_blank" rel="noreferrer">
                      Dotabuff
                    </a>
                    <a
                      href={`https://steamcommunity.com/profiles/${accountIdToSteam64(p.accountId)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Steam
                    </a>
                  </div>
                </article>
              ))}
              {!filteredFamiliar.length && <p className="help">No players matched that filter.</p>}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function PlayerList({ players, showRecent }: { players: CheckedPlayer[]; showRecent?: boolean }) {
  return (
    <ul className="player-list">
      {players.map((p, idx) => {
        const wr = winrate(p.profile?.wins, p.profile?.losses)
        const games =
          p.profile?.wins != null && p.profile?.losses != null ? p.profile.wins + p.profile.losses : null
        return (
          <li
            key={`${p.accountId}-${idx}`}
            className={p.familiar ? 'familiar' : p.isOwner ? 'you' : p.role === 'enemy' ? 'foe' : ''}
          >
            <div className="line">
              <div>
                <b>
                  {p.isOwner
                    ? `${p.personaname || 'You'} (you)`
                    : p.personaname ||
                      (p.medalName
                        ? `Enemy · ${p.medalName}${p.medalStars ? ` ${p.medalStars}` : ''}`
                        : p.accountId
                          ? 'Anonymous / private'
                          : `Enemy slot${p.slotIndex != null ? ` #${p.slotIndex}` : ''}`)}
                </b>
                <span className="id">
                  {p.hero ? `${p.hero} · ` : p.heroId ? `Hero #${p.heroId} · ` : ''}
                  {p.accountId ? p.accountId : 'ID hidden until after picks'}
                  {p.role === 'enemy' ? ' · enemy' : p.role === 'ally' ? ' · ally' : ''}
                </span>
              </div>
              {p.familiar && <FamiliarBadge rec={p.familiar} />}
              {!p.familiar && !p.isOwner && p.accountId && <span className="badge new">New to you</span>}
              {!p.familiar && !p.isOwner && !p.accountId && (
                <span className="badge new">Waiting for Steam ID</span>
              )}
            </div>

            <div className="stats-grid">
              <div>
                <em>Career</em>
                <strong>
                  {p.profile?.rankTier != null
                    ? rankLabel(p.profile.rankTier)
                    : p.medalName
                      ? `${p.medalName}${p.medalStars ? ` ${p.medalStars}` : ''}`
                      : '—'}
                </strong>
                <span>
                  {wr ? `${wr} WR` : p.rank != null ? `OW rank ${p.rank}` : 'WR n/a'}
                  {games != null ? ` · ${games} games` : ''}
                </span>
              </div>
              <div>
                <em>Vs you (history)</em>
                <strong>
                  {p.familiar
                    ? `${p.familiar.asEnemy} enemy · ${p.familiar.asAlly} ally`
                    : 'First meeting'}
                </strong>
                <span>
                  {p.familiar
                    ? `Your wins vs them ${p.familiar.winsAgainst}/${p.familiar.asEnemy || 0}`
                    : 'Not in your scanned matches'}
                </span>
              </div>
            </div>

            {showRecent && <RecentStrip matches={p.recentMatches} />}

            {p.accountId != null && (
              <div className="links">
                <a href={`https://www.opendota.com/players/${p.accountId}`} target="_blank" rel="noreferrer">
                  OpenDota
                </a>
                <a href={`https://www.dotabuff.com/players/${p.accountId}`} target="_blank" rel="noreferrer">
                  Dotabuff
                </a>
                <a
                  href={`https://steamcommunity.com/profiles/${accountIdToSteam64(p.accountId)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Steam
                </a>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function TeamBlock({ title, players }: { title: string; players: CheckedPlayer[] }) {
  return (
    <div className="team">
      <h3>{title}</h3>
      <PlayerList players={players} />
    </div>
  )
}
