# ReplayFace

Dota 2 web app that syncs your OpenDota match history and highlights players you have already played with.

## Features
- Connect via Steam / OpenDota URL or account ID
- Scan recent matches into a local “familiar players” index
- Paste a match ID to mark allies/enemies you have seen before
- Browse/filter the familiar list

## Run
```bash
cd dota-familiar
npm install
npm run dev
```

Open `http://localhost:5173`.

## Notes
- Uses public [OpenDota](https://www.opendota.com) API (proxied in Vite).
- Index is stored in `localStorage` (browser only).
- Private Steam profiles may hide player names.
- Scanning many matches is rate-limited on purpose.
