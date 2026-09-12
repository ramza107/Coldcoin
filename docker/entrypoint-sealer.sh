#!/bin/sh
set -eu

NAME="${SEALER_NAME}"
ADDR="$(sed -n "s/.*\"${NAME}\": {\\n[[:space:]]*\"address\": \"\\([^\"]*\\)\".*/\\1/p" /config/accounts.json 2>/dev/null || true)"

# Portable address extract with node-less awk/sed
ADDR="$(awk -v n="$NAME" '
  $0 ~ "\"" n "\"" {grab=1}
  grab && /"address"/ {
    gsub(/[",]/ "");
    print $2;
    exit
  }
' /config/accounts.json)"

if [ ! -d /root/.ethereum/geth ]; then
  geth init /genesis.json
  geth account import --password /config/password.txt /config/keys/${NAME}.hex
fi

exec geth \
  --networkid 10742 \
  --port "${P2P_PORT:-30303}" \
  --http --http.addr 0.0.0.0 --http.port 8545 \
  --http.api eth,net,web3,clique,admin,miner,txpool \
  --http.corsdomain "*" --http.vhosts "*" \
  --unlock "$ADDR" \
  --password /config/password.txt \
  --mine \
  --miner.etherbase "$ADDR" \
  --allow-insecure-unlock \
  --nodiscover \
  --verbosity 3
