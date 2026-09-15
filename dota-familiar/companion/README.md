# ReplayFace live companion (Windows)

## How it works

Two different things:

1. **Who is in your game right now** — only your Dota client knows this (Steam IDs of the 10 players). OpenDota / Dotabuff / Stratz do **not** publish the roster of a normal ranked pub while it is live.
2. **Everything about those players** — once you have Steam IDs, those databases already have rank, WR, recent matches, heroes, etc.

This companion solves (1): it gets enemy Steam IDs at match start (after picks) and POSTs them to ReplayFace. The web app does (2): OpenDota lookup + your familiar history.

Web pages alone cannot read the live Dota lobby.

## 1. Run the companion (serves the Live UI)

```bash
cd dota-familiar
npm run companion
```

Open **http://127.0.0.1:17321/** — this is the Live UI (same origin as `/lobby`).

Do **not** expect https://ramza107.github.io/Coldcoin/ to show the current game: browsers block GitHub Pages from reading localhost.

## 2. Enable Dota GSI (match-start signal)

1. Steam → Dota 2 → Properties → Launch Options → add:
   ```
   -gamestateintegration
   ```
2. Copy `gamestate_integration_replayface.cfg` into:
   ```
   …\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
   ```
   Create the `gamestate_integration` folder if it is missing.
3. Restart Dota.

GSI tells the companion that a match started. **Enemy Steam IDs are usually not in raw GSI** (Valve policy). For full enemy roster you need Overwolf GEP or a manual paste in the web UI.

## 3. Full enemy roster (Overwolf) — yes, we can

Ship the app in [`../overwolf-app/`](../overwolf-app/):

1. Install Overwolf, enable developer options, **Load unpacked** → `dota-familiar/overwolf-app`
2. Keep this companion running
3. Play Dota with `-gamestateintegration`
4. After picks (`STRATEGY_TIME`), the Overwolf app POSTs roster here; the web Live lobby shows familiar enemies + OpenDota intel

Same GEP path as other Dota overlays. A browser alone cannot do this.

Do **not** show enemy IDs during the pick/ban phase (Valve / Overwolf rules).

(Optional low-level stub: `overwolf-bridge.js`.)

## 4. Open ReplayFace Live UI

1. Open **http://127.0.0.1:17321/** (companion-hosted UI).
2. Connect & sync your account once.
3. Stay on **Live lobby** with Listening ON.
4. When Overwolf/GSI pushes the lobby, enemies appear.

## Manual / test without Dota

```bash
curl -X POST http://127.0.0.1:17321/lobby \
  -H "content-type: application/json" \
  --data-binary @live-lobby.sample.json
```

Or paste enemy account IDs in the web UI under **Paste enemies**.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/lobby` | Current lobby for the web app |
| POST | `/lobby` | Push Overwolf / manual roster |
| DELETE | `/lobby` | Clear |
| POST | `/gsi` | Dota Game State Integration |
| GET | `/health` | Health check |
