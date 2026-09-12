#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="${ROOT}/data/logs"

stop_pidfile() {
  local f="$1"
  if [[ -f "$f" ]]; then
    local pid
    pid="$(cat "$f")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.5
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$f"
  fi
}

if [[ -d "$LOGS" ]]; then
  for n in sealer1 sealer2 sealer3 rpc; do
    stop_pidfile "${LOGS}/${n}.pid"
  done
fi

# Fallback: kill geth processes using our datadirs
pkill -f "geth --datadir ${ROOT}/data/" 2>/dev/null || true
echo "Coldcoin network stopped"
