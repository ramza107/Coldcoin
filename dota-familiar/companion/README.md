# ReplayFace live companion (Windows)

Web pages cannot read your live Dota lobby. This tiny local server bridges **match-start roster → ReplayFace** so you see **enemies you already played with** as soon as the game starts (after picks).

## 1. Run the companion

```bash
cd dota-familiar/companion
node server.mjs
```

Leave it running. Status page: http://127.0.0.1:17321/

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

## 3. Full enemy roster (Overwolf)

After hero picks end (strategy / pre-game), Overwolf GEP exposes `roster` with Steam IDs. Use `overwolf-bridge.js` inside an Overwolf app window — it POSTs to `http://127.0.0.1:17321/lobby`.

Do **not** show enemy IDs during the pick/ban phase (Valve / Overwolf rules).

## 4. Open ReplayFace

1. Connect & sync your account once (builds the familiar index).
2. Open **Live lobby**.
3. Enable **Listen for live game**.
4. When the companion has enemies, the page marks familiar foes and loads their OpenDota stats + recent matches.

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
