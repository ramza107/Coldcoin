# ReplayFace Mini Client (legal)

Small local client that reads **your** Dota 2 match **online**, using only Valve/Overwolf-approved channels:

| Source | Legal? | What you get |
|--------|--------|----------------|
| **Dota GSI** (`-gamestateintegration`) | Yes (official) | Match started, clock, *your* hero/team |
| **Overwolf GEP** | Yes (approved overlays) | Full roster Steam IDs **after picks** |
| Memory / inject / OverPlus-style | No | Don't |

Public APIs (OpenDota) still provide **profiles**. This mini-client only supplies **who is in the lobby**.

```
Dota (online)
  ├─ GSI ──────────────► companion :17321 ──► Live UI
  └─ Overwolf GEP ─────► ReplayFace Live app ─┘
                              │
                              ▼
                         OpenDota profiles / familiar
```

## Windows — quick start

1. Install [Node.js LTS](https://nodejs.org/) and [Overwolf](https://www.overwolf.com/).
2. Steam → Dota 2 → Properties → Launch Options:
   ```
   -gamestateintegration
   ```
3. From repo:
   ```bat
   cd dota-familiar\mini-client
   install-gsi.bat
   start.bat
   ```
4. Overwolf → enable Developer options → **Load unpacked extension** → select `dota-familiar\overwolf-app`
5. Browser opens **http://127.0.0.1:17321/** — Connect once, leave **Live lobby** on.
6. Queue a match. After picks (`STRATEGY_TIME`) enemies + OpenDota intel appear.

`install-gsi.bat` copies `gamestate_integration_replayface.cfg` into the Dota `gamestate_integration` folder (it will ask for your Steam library path if not found).

## Without Overwolf

GSI alone usually **cannot** name enemies (Valve). You can still:
- see that a match started
- paste enemy IDs manually in Live lobby

Full automatic roster = Overwolf app (same API DotaPlus uses).

## What we will not build

- Process memory readers / injectors  
- Bypassing draft anonymity before `STRATEGY_TIME`  
- Tools that violate Dota / Overwolf ToS  

## Layout

| Path | Role |
|------|------|
| `../companion/server.mjs` | Local server + Live UI |
| `../overwolf-app/` | Legal GEP reader |
| `install-gsi.bat` | Installs Valve GSI cfg |
| `start.bat` | Build + run companion + open UI |
| `start.sh` | Same for Linux/mac (dev) |
