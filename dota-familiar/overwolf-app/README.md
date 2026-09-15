# ReplayFace Live (Overwolf)

Minimal Overwolf app that reads Dota 2 GEP `roster` **after picks** and POSTs enemy Steam IDs to the ReplayFace companion (`http://127.0.0.1:17321/lobby`).

## Can we do what Overwolf does?

**Yes — by shipping this Overwolf app** (same GEP channel DotaPlus / trackers use). A normal website cannot. Raw GSI alone usually does not include enemy Steam IDs.

Flow:

```
Dota client → Overwolf GEP (roster after STRATEGY_TIME)
           → ReplayFace Live app (this folder)
           → companion :17321
           → web Live lobby → OpenDota stats + familiar badges
```

## Install (Windows)

1. Install [Overwolf](https://www.overwolf.com/).
2. Steam → Dota 2 → Launch Options: `-gamestateintegration`
3. Run companion: `cd dota-familiar && npm run companion`
4. Load this unpacked app in Overwolf (Developers → Enable developer options → Load unpacked extension → select `overwolf-app/`).
5. Start Dota. After hero picks (`STRATEGY_TIME`), the app pushes the roster.
6. Open ReplayFace → **Live lobby** → Listening ON.

## Compliance

Valve hides `steamId` / `name` during the pick/ban phase. This app only pushes when match state is `STRATEGY_TIME` or later.

## Files

| File | Role |
|------|------|
| `manifest.json` | Overwolf WebApp, game id `7314` |
| `main.js` | GEP subscribe + roster parse + POST |
| `index.html` | Small status window |
| `icon.png` / `icon_gray.png` | App icons |

## Manual test without Dota

Companion still accepts:

```bash
curl -X POST http://127.0.0.1:17321/lobby \
  -H 'content-type: application/json' \
  --data-binary @../companion/live-lobby.sample.json
```
