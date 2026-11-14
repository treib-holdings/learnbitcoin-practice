#!/usr/bin/env bash
# Nightly backup of the practice network to R2 (bucket learnbitcoin-practice-backups):
#
#   chain/practice-chain_<TS>.tar.gz   the regtest datadir: blocks, chainstate,
#                                      indexes and the Core wallets (treasury, faucet)
#   bots/practice-bots_<TS>.db.gz      the faucet's payout records
#   manifests/practice_<TS>.json       height, tip and wallet balances at backup
#                                      time, for the restore drill to compare
#
# Secrets are not backed up: make-secrets.sh regenerates the RPC logins, and the
# tunnel token can be fetched again from the Cloudflare dashboard.
#
# The producer and the bots pause for about half a minute, and the node stops
# for about 20 seconds, so its files are copied at rest. Old backups expire by
# the bucket's lifecycle rule. A failure sends an alert to NTFY_TOPIC.
set -euo pipefail

OPS=/opt/learnbitcoin-practice/ops
CONF="$OPS/.rclone.conf"
BUCKET=${R2_BUCKET:-learnbitcoin-practice-backups}
TS=$(date -u +%Y%m%d-%H%M%S)
WORK=$(mktemp -d -t practice-backup.XXXXXX)
cd "$OPS"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
notify() {
  local topic
  topic=$(grep -E '^NTFY_TOPIC=' .env 2>/dev/null | cut -d= -f2- || true)
  [ -n "$topic" ] && curl -s -m 15 -H "Title: practice-net backup failed" -H "Priority: high" \
    -H "Tags: warning" -d "$1" "https://ntfy.sh/$topic" >/dev/null || true
}
fail() { log "backup failed: $1"; notify "$1"; exit 1; }
node_up() {
  docker compose start bitcoind >/dev/null
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' bitcoind)" = healthy ] && break
    sleep 3
  done
  docker compose start bots producer >/dev/null
}
trap 'rm -rf "$WORK"' EXIT

[ -r "$CONF" ] || fail "no R2 credentials at $CONF (run backup/save-r2-creds.sh)"
command -v rclone >/dev/null || fail "rclone is not installed"

# 1. Pause the producer and the bots, so height and balances hold still. From
#    here on, whatever happens, everything is started again on exit.
trap 'docker compose start bitcoind bots producer >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
docker compose stop producer bots >/dev/null
height=$(./cli.sh getblockcount)
best=$(./cli.sh getbestblockhash)
treasury=$(./cli.sh -rpcwallet=treasury getbalance)
faucet=$(./cli.sh -rpcwallet=faucet getbalance)
printf '{"ts":"%s","height":%s,"best":"%s","treasury_btc":"%s","faucet_btc":"%s"}\n' \
  "$TS" "$height" "$best" "$treasury" "$faucet" > "$WORK/practice_${TS}.json"

# 2. The faucet's records, through SQLite's own backup API.
python3 - /data/bots/bots.db "$WORK/practice-bots_${TS}.db" <<'PY'
import sqlite3, sys
src, dst = sqlite3.connect(sys.argv[1]), sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close()
src.close()
PY
gzip -9 "$WORK/practice-bots_${TS}.db"

# 3. Stop the node, copy its files at rest, start everything again.
stopped=$(date +%s)
docker compose stop -t 120 bitcoind >/dev/null
tar_ok=0
tar -C /data/bitcoin -czf "$WORK/practice-chain_${TS}.tar.gz" \
  --exclude=regtest/.cookie --exclude=regtest/debug.log regtest || tar_ok=$?
node_up
log "node paused for $(( $(date +%s) - stopped )) s at height $height"
[ "$tar_ok" -eq 0 ] || fail "could not archive the chain (tar exit $tar_ok)"

# 4. Upload and confirm each object arrived.
for pair in "chain:practice-chain_${TS}.tar.gz" "bots:practice-bots_${TS}.db.gz" "manifests:practice_${TS}.json"; do
  prefix=${pair%%:*}
  file=${pair#*:}
  rclone --config "$CONF" copy "$WORK/$file" "r2:$BUCKET/$prefix/" --quiet || fail "upload of $file failed"
  rclone --config "$CONF" lsf "r2:$BUCKET/$prefix/$file" | grep -q . || fail "$file is missing in R2 after upload"
  log "uploaded $prefix/$file ($(stat -c %s "$WORK/$file") bytes)"
done
log "backup $TS done: height $height, treasury $treasury BTC, faucet $faucet BTC"
