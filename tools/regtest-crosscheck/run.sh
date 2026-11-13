#!/usr/bin/env bash
# Cross-check the wallet library against Bitcoin Core on regtest.
#
# Starts a throwaway Core container (no network at all) on a box that
# already has a verified Core image, runs xcheck.py's three phases, prints
# results.json, and removes the container and its directory afterwards.
# The production bitcoind container is never touched.
#
#   XCHECK_HOST   ssh alias of the box (required)
#   XCHECK_IMAGE  a verified Bitcoin Core image on that box (required)
#   XCHECK_OUT    optional path to keep a copy of results.json
#
#   XCHECK_HOST=mybox XCHECK_IMAGE=me/bitcoind:31.2 tools/regtest-crosscheck/run.sh
set -euo pipefail

HOST=${XCHECK_HOST:?set XCHECK_HOST to the ssh alias of a box with Docker}
IMAGE=${XCHECK_IMAGE:?set XCHECK_IMAGE to a verified Bitcoin Core image on that box}
NAME=lbp-xcheck
REMOTE=/tmp/$NAME
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
# One multiplexed connection for every ssh/scp below: the boxes sit behind a
# Cloudflare tunnel, and many quick new connections can fail the handshake.
SSHO="-o ControlMaster=auto -o ControlPath=/tmp/lbp-cm-%C -o ControlPersist=120 -o BatchMode=yes -o ConnectTimeout=25"

cleanup() {
  ssh $SSHO "$HOST" "docker rm -f $NAME >/dev/null 2>&1 || true; rm -rf $REMOTE" || true
  ssh $SSHO -O exit "$HOST" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

node "$HERE/make-plan.ts" > "$WORK/plan.json"

ssh $SSHO "$HOST" "docker rm -f $NAME >/dev/null 2>&1 || true; rm -rf $REMOTE && mkdir -p $REMOTE"
scp $SSHO -q "$WORK/plan.json" "$HERE/xcheck.py" "$HOST:$REMOTE/"

ssh $SSHO "$HOST" bash -s <<EOF
set -e
docker run -d --name $NAME --network none --user "\$(id -u):\$(id -g)" \
  -v $REMOTE:$REMOTE --entrypoint sleep $IMAGE infinity >/dev/null
docker exec $NAME bitcoind -regtest -datadir=$REMOTE -daemon -txindex=1 \
  -fallbackfee=0.0002 -acceptnonstdtxn=0 >/dev/null
docker exec $NAME bitcoin-cli -regtest -datadir=$REMOTE -rpcwait getblockcount >/dev/null
python3 $REMOTE/xcheck.py derive
python3 $REMOTE/xcheck.py fund
EOF

scp $SSHO -q "$HOST:$REMOTE/utxos.json" "$WORK/"
node "$HERE/build-tx.ts" "$WORK"
scp $SSHO -q "$WORK/tx.hex" "$WORK/built.json" "$HOST:$REMOTE/"
ssh $SSHO "$HOST" "python3 $REMOTE/xcheck.py spend"
scp $SSHO -q "$HOST:$REMOTE/results.json" "$WORK/"

cat "$WORK/results.json"
if [ -n "${XCHECK_OUT:-}" ]; then cp "$WORK/results.json" "$XCHECK_OUT"; fi
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); ok=all(c["ok"] for c in r["derive"]) and r["fund"]["ok"] and r["spend"]["ok"]; print("ALL OK" if ok else "FAILED"); sys.exit(0 if ok else 1)' "$WORK/results.json"
