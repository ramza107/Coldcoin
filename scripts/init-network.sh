#!/usr/bin/env bash
# Initialize local Coldcoin node data directories from genesis.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${ROOT}/data"
GENESIS="${ROOT}/genesis/genesis.json"

NODES=(sealer1 sealer2 sealer3 rpc)

echo "==> Resetting data dirs under ${DATA}"
rm -rf "${DATA}"
mkdir -p "${DATA}"

for node in "${NODES[@]}"; do
  echo "==> Init ${node}"
  mkdir -p "${DATA}/${node}"
  geth --datadir "${DATA}/${node}" init "$GENESIS"
done

echo "==> Importing sealer keys"
"${ROOT}/scripts/import-account.sh" sealer1 "${DATA}/sealer1"
"${ROOT}/scripts/import-account.sh" sealer2 "${DATA}/sealer2"
"${ROOT}/scripts/import-account.sh" sealer3 "${DATA}/sealer3"

mkdir -p "${DATA}/sealer1/geth" "${DATA}/sealer2/geth" "${DATA}/sealer3/geth" "${DATA}/rpc/geth"

echo "==> Coldcoin genesis initialized"
echo "    Chain ID: 10742  |  Symbol: COLD  |  Consensus: Clique PoA"
