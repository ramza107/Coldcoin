import { useEffect, useMemo, useState } from 'react'
import {
  buildFamiliarIndex,
  fetchMatch,
  fetchPlayer,
  matchPlayersFromDetail,
  rankLabel,
  resolveAccountId,
} from './lib/opendota'
import { clearIndex, loadIndex, loadSavedAccount, saveAccountInput, saveIndex } from './lib/storage'
import type { CheckedPlayer, FamiliarIndex, FamiliarRecord } from './types'
import './App.css'

type Tab = 'check' | 'familiar' | 'sync'

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

export default function App() {
  const [accountInput, setAccountInput] = useState(loadSavedAccount())
  const [index, setIndex] = useState<FamiliarIndex | null>(null)
  const [tab, setTab] = useState<Tab>('sync')
  const [matchId, setMatchId] = useState('')
  const [checked, setChecked] = useState<CheckedPlayer[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [matchLimit, setMatchLimit] = useState(30)

  useEffect(() => {
    const saved = loadIndex()
    if (saved) {
      setIndex(saved)
      setTab('check')
    }
  }, [])

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
      setStatus('Loading profile & matches…')
      const built = await buildFamiliarIndex(accountId, matchLimit, (done, total) => {
        setProgress({ done, total })
        setStatus(`Scanning matches ${done}/${total}…`)
      })
      saveIndex(built)
      setIndex(built)
      setTab('check')
      setStatus(
        `Synced ${built.matchesScanned} matches · ${Object.keys(built.players).length} players remembered`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckMatch() {
    if (!index) {
      setError('Sync your account first')
      return
    }
    setError('')
    setBusy(true)
    setChecked([])
    try {
      const id = Number(matchId.trim())
      if (!Number.isFinite(id) || id <= 0) throw new Error('Enter a valid match ID')
      setStatus('Loading match…')
      const detail = await fetchMatch(id)
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
      setChecked(enriched)
      setStatus(`Match ${id} checked`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match check failed')
    } finally {
      setBusy(false)
    }
  }

  function handleReset() {
    clearIndex()
    setIndex(null)
    setChecked([])
    setTab('sync')
    setStatus('Cleared local data')
  }

  const radiant = checked.filter((p) => p.team === 'radiant')
  const dire = checked.filter((p) => p.team === 'dire')

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />
      <header className="topbar">
        <div className="brand">
          <span className="mark">RF</span>
          <div>
            <strong>ReplayFace</strong>
            <em>Dota familiar player radar</em>
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
          <p className="eyebrow">Know your lobby</p>
          <h1>Mark players you already faced</h1>
          <p className="lede">
            Sync your OpenDota history, then paste any match ID. Allies and enemies you have seen before get
            highlighted instantly.
          </p>
        </section>

        <nav className="tabs">
          <button type="button" className={tab === 'sync' ? 'on' : ''} onClick={() => setTab('sync')}>
            Sync
          </button>
          <button
            type="button"
            className={tab === 'check' ? 'on' : ''}
            onClick={() => setTab('check')}
            disabled={!index}
          >
            Check match
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
            <h2>Connect Steam / OpenDota</h2>
            <p className="help">
              Paste profile URL, SteamID64, or account ID. Example:{' '}
              <code>https://www.opendota.com/players/86745912</code>
            </p>
            <label className="field">
              <span>Your profile</span>
              <input
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                placeholder="OpenDota / Steam URL or ID"
                disabled={busy}
              />
            </label>
            <label className="field inline">
              <span>Matches to scan</span>
              <select
                value={matchLimit}
                onChange={(e) => setMatchLimit(Number(e.target.value))}
                disabled={busy}
              >
                <option value={20}>20 (fast)</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={80}>80 (slower)</option>
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
                {busy ? 'Syncing…' : index ? 'Re-sync history' : 'Sync & build familiar list'}
              </button>
              {index && (
                <button type="button" className="ghost" disabled={busy} onClick={handleReset}>
                  Reset
                </button>
              )}
            </div>
            <p className="fineprint">
              Data stays in your browser (localStorage). Uses public OpenDota API. Private Steam profiles may hide
              names.
            </p>
          </section>
        )}

        {tab === 'check' && index && (
          <section className="panel">
            <h2>Check a match</h2>
            <p className="help">Get match ID from OpenDota, Dotabuff, or the post-game scoreboard.</p>
            <div className="row">
              <label className="field grow">
                <span>Match ID</span>
                <input
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                  placeholder="e.g. 8123456789"
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="primary"
                disabled={busy || !matchId.trim()}
                onClick={handleCheckMatch}
              >
                {busy ? 'Checking…' : 'Scan lobby'}
              </button>
            </div>

            {checked.length > 0 && (
              <div className="teams">
                <TeamBlock title="Radiant" players={radiant} />
                <TeamBlock title="Dire" players={dire} />
              </div>
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
