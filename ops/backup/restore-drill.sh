#!/usr/bin/env bash
# Restore drill: fetch the newest backup from R2, start it in a throwaway node
# with no network, and check it against the manifest written at backup time
# (height, tip, wallet balances). The live node is never touched.
#
#   /opt/learnbitcoin-practice/ops/backup/restore-drill.sh
set -euo pipefail

OPS=/opt/learnbitcoin-practice/ops
CONF="$OPS/.rclone.conf"
BUCKET=${R2_BUCKET:-learnbitcoin-practice-backups}
NAME=practice-restore-drill
WORK=$(mktemp -d -t practice-restore.XXXXXX)

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

manifest=$(rclone --config "$CONF" lsf "r2:$BUCKET/manifests/" | sort | tail -n 1)
[ -n "$manifest" ] || { echo "no backups in r2:$BUCKET yet"; exit 1; }
ts=${manifest#practice_}
ts=${ts%.json}
echo "newest backup: $ts"
rclone --config "$CONF" copy "r2:$BUCKET/manifests/$manifest" "$WORK/"
rclone --config "$CONF" copy "r2:$BUCKET/chain/practice-chain_${ts}.tar.gz" "$WORK/"

mkdir "$WORK/data"
tar -C "$WORK/data" -xzf "$WORK/practice-chain_${ts}.tar.gz"
cp "$OPS/bitcoind/bitcoin.conf" "$WORK/data/bitcoin.conf"

docker run -d --name "$NAME" --network none --user 1000:1000 -v "$WORK/data:/data/bitcoin" \
  --entrypoint bitcoind learnbitcoin-practice/bitcoind:31.2 \
  -conf=/data/bitcoin/bitcoin.conf -datadir=/data/bitcoin >/dev/null
cli() { docker exec "$NAME" bitcoin-cli -conf=/data/bitcoin/bitcoin.conf -datadir=/data/bitcoin "$@"; }
cli -rpcwait getblockcount >/dev/null
for wallet in treasury faucet; do
  cli listwallets | grep -q "\"$wallet\"" || cli loadwallet "$wallet" >/dev/null
done

python3 - "$WORK/$manifest" "$(cli getblockcount)" "$(cli getbestblockhash)" \
  "$(cli -rpcwallet=treasury getbalance)" "$(cli -rpcwallet=faucet getbalance)" <<'PY'
import json, sys
from decimal import Decimal
m = json.load(open(sys.argv[1]))
got = {"height": int(sys.argv[2]), "best": sys.argv[3], "treasury_btc": sys.argv[4], "faucet_btc": sys.argv[5]}
checks = {
    "height": got["height"] == m["height"],
    "tip": got["best"] == m["best"],
    "treasury balance": Decimal(got["treasury_btc"]) == Decimal(m["treasury_btc"]),
    "faucet balance": Decimal(got["faucet_btc"]) == Decimal(m["faucet_btc"]),
}
for name, ok in checks.items():
    print(f"  {name}: {'match' if ok else 'MISMATCH'}")
print(f"  restored height {got['height']}, treasury {got['treasury_btc']} BTC, faucet {got['faucet_btc']} BTC")
print("RESTORE DRILL OK" if all(checks.values()) else "RESTORE DRILL FAILED")
sys.exit(0 if all(checks.values()) else 1)
PY
