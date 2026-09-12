#!/usr/bin/env bash
# Wire sealer/rpc nodes together via admin_addPeer (nodiscover mode).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ipc_call() {
  local datadir="$1"
  local method="$2"
  geth attach --exec "$method" "${datadir}/geth.ipc"
}

wait_ipc() {
  local datadir="$1"
  local i=0
  until [[ -S "${datadir}/geth.ipc" ]]; do
    sleep 0.5
    i=$((i + 1))
    if (( i > 60 )); then
      echo "timeout waiting for ${datadir}/geth.ipc" >&2
      exit 1
    fi
  done
}

echo "==> Waiting for node IPCs"
for n in sealer1 sealer2 sealer3 rpc; do
  wait_ipc "${ROOT}/data/${n}"
done

ENODE1="$(ipc_call "${ROOT}/data/sealer1" 'admin.nodeInfo.enode')"
ENODE2="$(ipc_call "${ROOT}/data/sealer2" 'admin.nodeInfo.enode')"
ENODE3="$(ipc_call "${ROOT}/data/sealer3" 'admin.nodeInfo.enode')"
ENODER="$(ipc_call "${ROOT}/data/rpc" 'admin.nodeInfo.enode')"

# Strip quotes
ENODE1="${ENODE1%\"}"; ENODE1="${ENODE1#\"}"
ENODE2="${ENODE2%\"}"; ENODE2="${ENODE2#\"}"
ENODE3="${ENODE3%\"}"; ENODE3="${ENODE3#\"}"
ENODER="${ENODER%\"}"; ENODER="${ENODER#\"}"

# Replace advertised IP with 127.0.0.1 for local mesh
fix_enode() {
  echo "$1" | sed -E 's/@[^:]+:/@127.0.0.1:/'
}

E1="$(fix_enode "$ENODE1")"
E2="$(fix_enode "$ENODE2")"
E3="$(fix_enode "$ENODE3")"
ER="$(fix_enode "$ENODER")"

echo "==> Connecting peers"
for datadir in "${ROOT}/data/sealer1" "${ROOT}/data/sealer2" "${ROOT}/data/sealer3" "${ROOT}/data/rpc"; do
  ipc_call "$datadir" "admin.addPeer('${E1}')" >/dev/null || true
  ipc_call "$datadir" "admin.addPeer('${E2}')" >/dev/null || true
  ipc_call "$datadir" "admin.addPeer('${E3}')" >/dev/null || true
  ipc_call "$datadir" "admin.addPeer('${ER}')" >/dev/null || true
done

echo "==> Peer mesh:"
ipc_call "${ROOT}/data/rpc" 'admin.peers.length'
echo "==> Block number:"
ipc_call "${ROOT}/data/rpc" 'eth.blockNumber'
