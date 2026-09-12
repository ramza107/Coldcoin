#!/usr/bin/env bash
# Start a Clique sealer node.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:?usage: start-sealer.sh <sealer1|sealer2|sealer3>}"
PORT="${2:?usage: start-sealer.sh <name> <p2p-port> [http-port] [authrpc-port]}"
HTTP_PORT="${3:-0}"
AUTHRPC_PORT="${4:-$((PORT + 1000))}"

ADDRESS="$(node -e "console.log(require('${ROOT}/config/accounts.json').${NAME}.address)")"
DATADIR="${ROOT}/data/${NAME}"
PASSWORD_FILE="${ROOT}/config/password.txt"
NETWORK_ID=10742

if [[ ! -d "${DATADIR}/geth" ]]; then
  echo "Node not initialized. Run: ./scripts/init-network.sh" >&2
  exit 1
fi

EXTRA_HTTP=()
if [[ "$HTTP_PORT" != "0" ]]; then
  EXTRA_HTTP=(
    --http --http.addr 0.0.0.0 --http.port "$HTTP_PORT"
    --http.api eth,net,web3,clique,admin,miner,personal,txpool,debug
    --http.corsdomain "*" --http.vhosts "*"
  )
fi

exec geth \
  --datadir "$DATADIR" \
  --networkid "$NETWORK_ID" \
  --syncmode full \
  --port "$PORT" \
  --authrpc.port "$AUTHRPC_PORT" \
  --authrpc.addr 127.0.0.1 \
  --authrpc.vhosts localhost \
  --unlock "$ADDRESS" \
  --password "$PASSWORD_FILE" \
  --mine \
  --miner.etherbase "$ADDRESS" \
  --allow-insecure-unlock \
  --nodiscover \
  --verbosity 3 \
  "${EXTRA_HTTP[@]}"
