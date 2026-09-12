#!/bin/sh
set -eu

# Keep re-wiring peers: compose restarts / nodiscover otherwise leave the mesh empty.
while true; do
  sleep 8

  rpc() {
    host="$1"
    method="$2"
    params="${3:-[]}"
    wget -qO- --header='Content-Type: application/json' \
      --post-data="{\"jsonrpc\":\"2.0\",\"method\":\"${method}\",\"params\":${params},\"id\":1}" \
      "http://${host}:8545" 2>/dev/null || true
  }

  enode_of() {
    host="$1"
    raw="$(rpc "$host" admin_nodeInfo)"
    echo "$raw" | sed -n 's/.*"enode":"\([^"]*\)".*/\1/p' | head -1 | sed "s/@[^:]*:/@${host}:/"
  }

  E1="$(enode_of 172.28.0.11)"
  E2="$(enode_of 172.28.0.12)"
  E3="$(enode_of 172.28.0.13)"
  ER="$(enode_of 172.28.0.20)"

  for host in 172.28.0.11 172.28.0.12 172.28.0.13 172.28.0.20; do
    for peer in "$E1" "$E2" "$E3" "$ER"; do
      [ -n "$peer" ] || continue
      rpc "$host" admin_addPeer "[\"${peer}\"]" >/dev/null 2>&1 || true
    done
  done

  echo "Coldcoin docker peer mesh refresh $(date -u +%H:%M:%S)"
done
