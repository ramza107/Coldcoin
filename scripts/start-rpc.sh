#!/usr/bin/env bash
# Start the public RPC / faucet node (does not seal by default).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATADIR="${ROOT}/data/rpc"
PASSWORD_FILE="${ROOT}/config/password.txt"
NETWORK_ID=10742

if [[ ! -d "${DATADIR}/geth" ]]; then
  echo "Node not initialized. Run: ./scripts/init-network.sh" >&2
  exit 1
fi

# Faucet / transfers use local private keys via ethers — no unlock required on RPC.
exec geth \
  --datadir "$DATADIR" \
  --networkid "$NETWORK_ID" \
  --port 30306 \
  --authrpc.port 8555 \
  --authrpc.addr 127.0.0.1 \
  --http --http.addr 0.0.0.0 --http.port 8545 \
  --http.api eth,net,web3,clique,admin,txpool,debug \
  --http.corsdomain "*" --http.vhosts "*" \
  --ws --ws.addr 0.0.0.0 --ws.port 8546 \
  --ws.api eth,net,web3,clique,txpool \
  --ws.origins "*" \
  --nodiscover \
  --verbosity 3
