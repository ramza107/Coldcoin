import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  absorbMatchIntoIndex,
  buildFamiliarIndex,
  fetchLatestMatchId,
  fetchMatch,
  fetchPlayer,
  matchPlayersFromDetail,
  rankLabel,
  resolveAccountId,
} from './lib/opendota'
import {
  clearIndex,
  loadIndex,
  loadLastMatchId,
  loadSavedAccount,
  loadWatchEnabled,
  saveAccountInput,
  saveIndex,
  saveLastMatchId,
  saveWatchEnabled,
} from './lib/storage'
import type { CheckedPlayer, FamiliarIndex, FamiliarRecord } from './types'
import './App.css'

type Tab = 'live' | 'familiar' | 'sync'

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
    enriched.push({ ...row, familiar, profile })
  }
  return enriched
}

export default function App() {
  const [accountInput, setAccountInput] = useState(loadSavedAccount())
  const [index, setIndex] = useState<FamiliarIndex | null>(null)
  const [tab, setTab] = useState<Tab>('sync')
  const [checked, setChecked] = useState<CheckedPlayer[]>([])
  const [activeMatchId, setActiveMatchId] = useState<number | null>(loadLastMatchId())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [matchLimit, setMatchLimit] = useState(30)
  const [watch, setWatch] = useState(loadWatchEnabled())
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null)
  const indexRef = useRef<FamiliarIndex | null>(null)
  const bootRef = useRef(false)
  indexRef.current = index

  const loadMatchById = useCallback(async (matchId: number, current: FamiliarIndex, absorbNew: boolean) => {
    const previousId = loadLastMatchId()
    const detail = await fetchMatch(matchId)
    // Badge "played before" should use history BEFORE absorbing this match
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
          ? `Auto-loaded match ${result.matchId} · ${result.familiarCount} familiar`
          : `Latest match ${result.matchId} · ${result.familiarCount} familiar`,
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
        setStatus('Auto-pulling your latest match…')
        await pullLatest(saved, false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to auto-load latest match')
      } finally {
        setBusy(false)
      }
    })()
  }, [pullLatest])

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
        setStatus(`New match auto-loaded: ${result.matchId} · ${result.familiarCount} familiar`)
        setTab('live')
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
      setWatch(true)
      saveWatchEnabled(true)
      setStatus(`Synced ${built.matchesScanned} matches · auto-loading latest…`)
      await pullLatest(built, false)
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
      setTab('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }

  function toggleWatch() {
    const next = !watch
    setWatch(next)
    saveWatchEnabled(next)
    setStatus(next ? 'Auto-watch ON — checking OpenDota every ~45s' : 'Auto-watch OFF')
  }

  function handleReset() {
    clearIndex()
    localStorage.removeItem('dota-familiar:last-match:v1')
    setIndex(null)
    setChecked([])
    setActiveMatchId(null)
    setWatch(false)
    saveWatchEnabled(false)
    setTab('sync')
    setStatus('Cleared local data')
  }

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
            <em>Auto familiar radar for Dota</em>
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
          <p className="eyebrow">No match links needed</p>
          <h1>Auto-pull your games</h1>
          <p className="lede">
            Connect once. ReplayFace pulls your latest OpenDota match automatically and highlights players you already
            faced. Keep auto-watch on to update after every game.
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
            Live match
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
              Profile is needed only for first setup. After that matches are pulled automatically — no match IDs.
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
                {busy ? 'Working…' : index ? 'Re-sync & auto-load' : 'Connect & auto-load'}
              </button>
              {index && (
                <button type="button" className="ghost" disabled={busy} onClick={handleReset}>
                  Reset
                </button>
              )}
            </div>
            <p className="fineprint">
              OpenDota usually shows a match a few minutes after it ends. Draft lobby before game start needs a desktop
              overlay later — web apps cannot read your live Dota client directly.
            </p>
          </section>
        )}

        {tab === 'live' && index && (
          <section className="panel">
            <div className="row spread">
              <div>
                <h2>Your latest match</h2>
                <p className="help" style={{ marginBottom: 0 }}>
                  {activeMatchId ? (
                    <>
                      Match <code>{activeMatchId}</code>
                      {lastCheckedAt ? ` · updated ${new Date(lastCheckedAt).toLocaleTimeString()}` : ''}
                      {familiarInMatch ? ` · ${familiarInMatch} familiar` : ''}
                    </>
                  ) : (
                    'Waiting for OpenDota…'
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

            {watch && (
              <div className="banner ok" style={{ marginTop: '0.9rem' }}>
                Auto-watch is on. Checking OpenDota every ~45s for a new finished match.
              </div>
            )}

            {checked.length > 0 ? (
              <div className="teams">
                <TeamBlock title="Radiant" players={radiant} />
                <TeamBlock title="Dire" players={dire} />
              </div>
            ) : (
              <p className="help" style={{ marginTop: '1rem' }}>
                No match loaded yet. Click refresh, or wait for auto-watch.
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
                    <a
                      href={`https://www.opendota.com/players/${p.accountId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      OpenDota
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

function TeamBlock({ title, players }: { title: string; players: CheckedPlayer[] }) {
  return (
    <div className="team">
      <h3>{title}</h3>
      <ul>
        {players.map((p, idx) => (
          <li key={`${p.accountId}-${idx}`} className={p.familiar ? 'familiar' : p.isOwner ? 'you' : ''}>
            <div className="line">
              <div>
                <b>{p.isOwner ? `${p.personaname || 'You'} (you)` : p.personaname || 'Anonymous / private'}</b>
                <span className="id">
                  Hero #{p.heroId}
                  {p.accountId ? ` · ${p.accountId}` : ' · no account'}
                  {p.profile?.rankTier != null ? ` · ${rankLabel(p.profile.rankTier)}` : ''}
                </span>
              </div>
              {p.familiar && <FamiliarBadge rec={p.familiar} />}
              {!p.familiar && !p.isOwner && p.accountId && <span className="badge new">New to you</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
