#!/usr/bin/env bash
# Import a hex private key into a geth datadir as an unlocked account keystore.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:?usage: import-account.sh <name> <datadir>}"
DATADIR="${2:?usage: import-account.sh <name> <datadir>}"
PASSWORD_FILE="${ROOT}/config/password.txt"
KEY_FILE="${ROOT}/config/keys/${NAME}.hex"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "missing key: $KEY_FILE" >&2
  exit 1
fi

mkdir -p "$DATADIR"
geth account import \
  --datadir "$DATADIR" \
  --password "$PASSWORD_FILE" \
  "$KEY_FILE"
