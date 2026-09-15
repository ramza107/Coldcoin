# ReplayFace

Dota 2 familiar-player radar: sync OpenDota history, then at **match start** flag enemies you already played with and show their recent form.

## Features
- Connect via Steam / OpenDota URL or account ID
- Scan recent matches into a local familiar index
- **Live lobby**: enemies when the game starts (local companion + Overwolf/GSI)
- Paste enemy IDs if you do not have Overwolf yet
- Last finished match + familiar list

## Run web app
```bash
cd dota-familiar
npm install
npm run dev
```

Open `http://localhost:5173`.

## Live enemies (Windows) — legal mini-client

```bat
cd dota-familiar\mini-client
install-gsi.bat
start.bat
open-overwolf-app.bat
```

Details: [`mini-client/README.md`](mini-client/README.md).

Uses only **Dota GSI** + **Overwolf GEP** (no memory cheats). Open **http://127.0.0.1:17321/** for the current game — not GitHub Pages.

## Notes
- Uses public [OpenDota](https://www.opendota.com) API.
- Index is stored in `localStorage`.
- Raw GSI usually does **not** include enemy account IDs (Valve). Full roster needs Overwolf GEP after strategy time, or manual paste.
- Do not reveal enemy IDs during the pick/ban phase.
