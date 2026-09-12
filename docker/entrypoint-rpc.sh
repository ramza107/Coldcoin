#!/bin/sh
set -eu

if [ ! -d /root/.ethereum/geth ]; then
  geth init /genesis.json
fi

exec geth \
  --networkid 10742 \
  --port 30303 \
  --http --http.addr 0.0.0.0 --http.port 8545 \
  --http.api eth,net,web3,clique,admin,txpool,debug \
  --http.corsdomain "*" --http.vhosts "*" \
  --ws --ws.addr 0.0.0.0 --ws.port 8546 \
  --ws.api eth,net,web3,clique,txpool \
  --ws.origins "*" \
  --nodiscover \
  --verbosity 3
