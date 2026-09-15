#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "ReplayFace Mini Client"
echo "Legal live path: Dota GSI + Overwolf GEP -> companion -> OpenDota"
echo

command -v node >/dev/null || { echo "Node.js required"; exit 1; }

if [[ ! -f dist/index.html ]]; then
  echo "No prebuilt UI — building once..."
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run build
else
  echo "Using prebuilt UI in dist/ (no npm build needed)"
fi

echo
echo "Companion: http://127.0.0.1:17321/  (keep this running)"
echo "On Windows: also load ../overwolf-app in Overwolf for enemy Steam IDs"
echo

if command -v xdg-open >/dev/null; then
  xdg-open "http://127.0.0.1:17321/" >/dev/null 2>&1 || true
elif command -v open >/dev/null; then
  open "http://127.0.0.1:17321/" || true
fi

exec node companion/server.mjs
