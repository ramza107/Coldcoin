#!/usr/bin/env bash
# Boot the full local Coldcoin network (3 sealers + RPC).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="${ROOT}/data/logs"
mkdir -p "$LOGS"

if [[ ! -d "${ROOT}/data/sealer1/geth" ]]; then
  "${ROOT}/scripts/init-network.sh"
fi

# Stop previous run if any
"${ROOT}/scripts/stop-network.sh" >/dev/null 2>&1 || true

echo "==> Starting sealers"
nohup "${ROOT}/scripts/start-sealer.sh" sealer1 30303 0 8551 >"${LOGS}/sealer1.log" 2>&1 &
echo $! >"${LOGS}/sealer1.pid"
nohup "${ROOT}/scripts/start-sealer.sh" sealer2 30304 0 8552 >"${LOGS}/sealer2.log" 2>&1 &
echo $! >"${LOGS}/sealer2.pid"
nohup "${ROOT}/scripts/start-sealer.sh" sealer3 30305 0 8553 >"${LOGS}/sealer3.log" 2>&1 &
echo $! >"${LOGS}/sealer3.pid"

echo "==> Starting RPC"
nohup "${ROOT}/scripts/start-rpc.sh" >"${LOGS}/rpc.log" 2>&1 &
echo $! >"${LOGS}/rpc.pid"

sleep 3
"${ROOT}/scripts/connect-peers.sh"

echo
echo "Coldcoin is up"
echo "  RPC HTTP: http://127.0.0.1:8545"
echo "  RPC WS:   ws://127.0.0.1:8546"
echo "  Chain ID: 10742"
echo "  Symbol:   COLD"
echo "  Logs:     ${LOGS}"
