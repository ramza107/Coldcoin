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

## Live enemies (Windows)
```bash
npm run companion
```

Then follow [`companion/README.md`](companion/README.md):
1. Dota launch option `-gamestateintegration`
2. Copy GSI cfg into the Dota `gamestate_integration` folder
3. After picks, Overwolf bridge (or paste) supplies enemy Steam IDs
4. Web app → **Live lobby** → Listening ON

## Notes
- Uses public [OpenDota](https://www.opendota.com) API.
- Index is stored in `localStorage`.
- Raw GSI usually does **not** include enemy account IDs (Valve). Full roster needs Overwolf GEP after strategy time, or manual paste.
- Do not reveal enemy IDs during the pick/ban phase.
