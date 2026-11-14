#!/usr/bin/env bash
# Starts the practice chain again from its first block.
#
#   /opt/learnbitcoin-practice/ops/reset-chain.sh          says what it would do, and changes nothing
#   /opt/learnbitcoin-practice/ops/reset-chain.sh --yes    does it
#
# What a reset is. The chain, its index, the explorer's database, the Core
# wallets (treasury and faucet) and the faucet's records are put aside, and a
# new chain is mined: the same network, host names, settings, secrets and
# certificate, and no history. A wallet a reader has made keeps its keys and
# shows no coins. So: once, after the last test and before the first reader.
# After that, a reset empties real wallets.
#
# Nothing is deleted. The old data is moved to /data/before-reset-<time>/ and
# stays there until someone removes it. The last lines this script prints say
# how to put it back, whether it finished or stopped half-way.
#
# If it stops half-way, run it again: the old chain stays in the folder the
# first run made (its name is kept in /data/reset-unfinished until a run
# finishes), and whatever the failed run made goes to /data/failed-reset-<time>/.
#
# Run it as the operator (it uses sudo to move folders), not while the nightly
# backup is running, and in a session that outlives the connection (tmux, or
# nohup with its output in a file). It takes about five minutes; the explorer
# and the Electrum port are away for that long.
set -euo pipefail

OPS=/opt/learnbitcoin-practice/ops
# Regtest halves the block reward every 150 blocks, so the first 5,000 blocks
# issue nearly all of the chain's 15,000 coins. They all go to the treasury.
SETUP_BLOCKS=${SETUP_BLOCKS:-5000}
# Blocks per reward address, as the block producer does it: no address ends
# up with a history of thousands of rewards.
BATCH=100
case "$SETUP_BLOCKS" in
  ''|*[!0-9]*) echo "SETUP_BLOCKS must be a whole number."; exit 1 ;;
esac
# Under 200 the treasury has almost nothing it may spend yet; far above 40,000
# the blocks' times would run more than two hours past the node's clock.
[ "$SETUP_BLOCKS" -ge 200 ] && [ "$SETUP_BLOCKS" -le 40000 ] || { echo "SETUP_BLOCKS must be between 200 and 40000."; exit 1; }
STAMP=$(date -u +%Y%m%d-%H%M%S)
KEEP=/data/before-reset-$STAMP
# What a run that failed had made, when this is a second run.
JUNK=/data/failed-reset-$STAMP
# While a reset is unfinished, this file names the folder that holds the old chain.
MARK=/data/reset-unfinished
LOCK=/tmp/practice-reset.lock
moved=0
finished=0
cd "$OPS"
again=0
if [ -r "$MARK" ]; then
  again=1
  moved=1
  KEEP=$(cat "$MARK")
  sudo test -d "$KEEP" || { echo "$MARK names $KEEP, which is not there. Look before going on."; exit 1; }
fi

log() { echo "$(date -u +%H:%M:%S) $*"; }
die() {
  log "STOPPED: $*"
  exit 1
}
# Prints how to put the old chain back, for the state things are in right now:
# only what was really moved is moved back.
go_back() {
  echo "  cd $OPS"
  echo "  docker compose stop producer bots mempool-web mempool-api mempool-db electrs && docker compose stop -t 120 bitcoind"
  echo "  sudo install -d -m 700 /data/abandoned-$STAMP /data/abandoned-$STAMP/bots"
  local pair name path owner
  for pair in bitcoin-regtest:/data/bitcoin/regtest electrs:/data/electrs mempool-db:/data/mempool-db \
              bots/bots.db:/data/bots/bots.db bots/bots.db-wal:/data/bots/bots.db-wal \
              bots/bots.db-shm:/data/bots/bots.db-shm bots/bots.db-journal:/data/bots/bots.db-journal; do
    name=${pair%%:*}
    path=${pair#*:}
    owner=$name
    case "$name" in bots/bots.db-*) owner=bots/bots.db ;; esac
    if [ -e "$path" ] && sudo test -e "$KEEP/$owner"; then
      echo "  sudo mv $path /data/abandoned-$STAMP/$name"
    fi
    # The test in front: if the line before it did not move the new data away, stop there
    # (mv would otherwise put the old folder inside the one still in place).
    if sudo test -e "$KEEP/$name"; then echo "  sudo test ! -e $path && sudo mv $KEEP/$name $path"; fi
  done
  echo "  sudo rm -f $MARK"
  echo "  docker compose up -d --force-recreate mempool-api && docker compose up -d"
}
# However the script ends: the node forgets the mock clock, the lock goes, and
# if it did not finish, it says where things stand.
finish() {
  local code=$?
  trap - EXIT
  # To stderr: if the script ended inside a call such as "cli ... >/dev/null",
  # its standard output still points at /dev/null here.
  exec >&2
  cli setmocktime 0 >/dev/null 2>&1 || true
  rmdir "$LOCK" 2>/dev/null || true
  [ "$finished" = 0 ] || return 0
  echo
  if [ "$moved" = 1 ]; then
    log "The reset did not finish (exit $code). Nothing was deleted; the services it stopped are still stopped."
    echo "The old chain is in $KEEP . Either run this script again (a new chain from"
    echo "the first block; what this run made goes to /data/failed-reset-<time>), or go back to the old chain:"
    go_back
  else
    log "Stopped before anything was moved (exit $code). To start whatever was stopped:  cd $OPS && docker compose up -d"
  fi
}
cli() { ./cli.sh "$@"; }
# What the chain index says the height is, asked from inside the compose network.
index_height() { docker exec router wget -q -T 5 -O- http://electrs:3000/blocks/tip/height 2>/dev/null || true; }
bots_get() { docker exec router wget -q -T 10 -O- "http://bots:8080$1" 2>/dev/null || true; }
# What the explorer says the height is, through its own web server (so: database, backend and frontend).
explorer_height() { docker exec router wget -q -T 5 -O- http://mempool-web:8080/api/blocks/tip/height 2>/dev/null || true; }
# What the index says the height is over the Electrum protocol (what Sparrow and the explorer use),
# asked from this host at the container's own address.
electrum_height() {
  local ip
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' electrs 2>/dev/null || true)
  python3 -c '
import json, socket, sys
s = socket.create_connection((sys.argv[1], 50001), 5)
s.settimeout(5)
s.sendall(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"blockchain.headers.subscribe\",\"params\":[]}\n")
buf = b""
while not buf.endswith(b"\n"):
    chunk = s.recv(65536)
    if not chunk:
        break
    buf += chunk
print(json.loads(buf)["result"]["height"])
' "$ip" 2>/dev/null || true
}
# The faucet's coins and the coins on their way to it, in sats, from what /health answered (0 if it said nothing).
faucet_coins() { printf '%s' "$1" | python3 -c 'import json,sys; h=json.load(sys.stdin); print(h["faucet_sats"] + h["faucet_pending_sats"])' 2>/dev/null || echo 0; }
warnings=0
warn() { warnings=$((warnings + 1)); log "   LOOK AT THIS: $*"; }

[ "$(id -u)" -ne 0 ] || { echo "Run this as the operator, not as root."; exit 1; }
docker compose config -q || { echo "compose.yaml does not read as valid."; exit 1; }
for c in bitcoind electrs mempool-db mempool-api mempool-web bots producer router; do
  docker inspect "$c" >/dev/null 2>&1 || { echo "There is no container named $c."; exit 1; }
done
# Every check below asks through the router.
[ "$(docker inspect -f '{{.State.Running}}' router)" = true ] \
  || { echo "The router container is not running. Start it first:  docker compose up -d router"; exit 1; }
case "$(systemctl show -p ActiveState --value practice-backup.service 2>/dev/null || true)" in
  active|activating|reloading|deactivating)
    echo "The nightly backup is running. Try again when it has finished."
    exit 1 ;;
esac

old_height=$(cli getblockcount 2>/dev/null || echo unknown)
old_tip=$(cli getbestblockhash 2>/dev/null || echo unknown)
if [ "$again" = 1 ]; then
  # What the node says now is the chain a failed run left. The old chain's numbers are in its folder.
  old_height=$(sudo sed -n 's/^height //p' "$KEEP/README")
  old_tip=$(sudo sed -n 's/^tip //p' "$KEEP/README")
fi

if [ "${1:-}" != "--yes" ]; then
  cat <<TXT
This would start the practice chain again from block 0.

  The chain now: height $old_height.
  Moved aside to $KEEP (not deleted):
    /data/bitcoin/regtest   the chain and the Core wallets
    /data/electrs           the chain index
    /data/mempool-db        the explorer's database
    /data/bots/bots.db      the faucet's records and the pot's counter
  Then: a new chain of $SETUP_BLOCKS blocks to a new treasury wallet, the index
  and the explorer built again from it, and the producer and the bots started.

Every practice wallet that exists today will show no coins afterwards.
To do it:  $0 --yes
TXT
  [ "$again" = 0 ] || echo "An earlier reset did not finish. The old chain is already in $KEEP and stays there; what that run made will go to $JUNK."
  exit 0
fi

mkdir "$LOCK" 2>/dev/null || {
  echo "Another reset is running, or one was killed and left $LOCK behind."
  echo "If no reset-chain.sh is running (ps aux | grep reset-chain), remove it:  rmdir $LOCK"
  exit 1
}
trap finish EXIT
# A signal ends the script through the same door (bash runs these once the command in hand returns).
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

log "The chain now: height $old_height, tip $old_tip"

log "1. Stopping everything that reads or writes the chain"
docker compose stop producer bots mempool-web mempool-api mempool-db electrs >/dev/null
docker compose stop -t 120 bitcoind >/dev/null
# Nothing is moved from under a program that still runs.
for c in producer bots mempool-web mempool-api mempool-db electrs bitcoind; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = false ] || die "$c is still running"
done
node_exit=$(docker inspect -f '{{.State.ExitCode}}' bitcoind)
[ "$node_exit" = 0 ] || log "   the node did not end cleanly (exit code $node_exit); its files are kept as they are"

log "2. Moving the old data aside, to $KEEP"
if [ "$again" = 0 ]; then
  sudo mkdir -m 700 "$KEEP"
  sudo mkdir "$KEEP/bots"
  printf 'The practice chain as it was before the reset of %s.\nheight %s\ntip %s\nthe node ended with exit code %s (0 is a clean stop)\n' \
    "$STAMP" "$old_height" "$old_tip" "$node_exit" | sudo tee "$KEEP/README" >/dev/null
  echo "$KEEP" | sudo tee "$MARK" >/dev/null
else
  log "   an earlier run did not finish: the old chain stays in $KEEP, what that run made goes to $JUNK"
fi
moved=1
# The first thing ever moved away from a place is the old data. Anything found
# there on a later run was made by a run that failed.
#   aside <path> <its name in the folder> [<the thing it belongs to>]
aside() {
  [ -e "$1" ] || return 0
  if sudo test -e "$KEEP/${3:-$2}"; then
    sudo mkdir -p "$JUNK/bots"
    sudo chmod 700 "$JUNK"
    sudo mv "$1" "$JUNK/$2"
  else
    sudo mv "$1" "$KEEP/$2"
  fi
}
aside /data/bitcoin/regtest bitcoin-regtest
aside /data/electrs electrs
aside /data/mempool-db mempool-db
# The database's side files first: they go where the database goes.
for f in bots.db-wal bots.db-shm bots.db-journal bots.db; do
  aside "/data/bots/$f" "bots/$f" bots/bots.db
done
# Empty folders with the owners the containers expect (as ops/bootstrap.sh made them).
sudo install -d -o 1000 -g 1000 /data/electrs
sudo install -d /data/mempool-db

log "3. A new chain: the node starts with no blocks"
docker compose up -d bitcoind >/dev/null
# More than one try: bitcoin-cli gives up at once ("Could not locate RPC credentials") when it looks
# for the cookie file a moment before a starting node has written it.
up=0
for _ in $(seq 1 9); do
  if cli -rpcwait -rpcwaittimeout=20 getblockcount >/dev/null 2>&1; then up=1; break; fi
  sleep 2
done
[ "$up" = 1 ] || die "the node did not come up"
[ "$(cli getblockcount)" = "0" ] || die "the node did not start from block 0"
cli -named createwallet wallet_name=treasury load_on_startup=true >/dev/null

log "4. Mining $SETUP_BLOCKS blocks to the treasury, a new reward address every $BATCH"
# Mined in one go, each block would be stamped a little later than the one
# before and the chain's clock would run some minutes ahead of the real one.
# So the node is told it is a little earlier while these blocks are made. Its
# clock then stands still, and a block's time goes up one second about every
# six blocks (the median-time rule): the last block is stamped about five
# minutes, plus the time the mining took, before now. A regtest node takes
# this from its operator; it forgets it when it is told 0 or restarts.
back=$((SETUP_BLOCKS / 6 + 300))
cli setmocktime "$(( $(date +%s) - back ))" >/dev/null
mined=0
while [ "$mined" -lt "$SETUP_BLOCKS" ]; do
  n=$BATCH
  [ $((SETUP_BLOCKS - mined)) -ge "$n" ] || n=$((SETUP_BLOCKS - mined))
  address=$(cli -rpcwallet=treasury getnewaddress setup bech32)
  cli generatetoaddress "$n" "$address" >/dev/null
  mined=$((mined + n))
done
cli setmocktime 0 >/dev/null
[ "$(cli getblockcount)" = "$SETUP_BLOCKS" ] || die "expected height $SETUP_BLOCKS, the node says $(cli getblockcount)"
tip_time=$(cli getblockheader "$(cli getbestblockhash)" | python3 -c 'import json,sys; print(json.load(sys.stdin)["time"])')
tip_age=$(( $(date +%s) - tip_time ))
log "   height $SETUP_BLOCKS; the newest block is stamped $tip_age s before now"
[ "$tip_age" -ge 0 ] || die "the newest block is stamped $(( -tip_age )) s after now"
treasury=$(cli -rpcwallet=treasury getbalance)
log "   treasury: $treasury coins that can be spent"
[ "$SETUP_BLOCKS" -lt 250 ] || [ "${treasury%%.*}" -ge 3000 ] || die "the treasury wallet does not see the coins it mined"

log "5. The chain index, built again from the new chain"
docker compose up -d electrs >/dev/null
for _ in $(seq 1 100); do
  [ "$(index_height)" = "$SETUP_BLOCKS" ] && break
  sleep 3
done
[ "$(index_height)" = "$SETUP_BLOCKS" ] || die "the index is at height '$(index_height)', not $SETUP_BLOCKS"

log "6. The explorer, with an empty database"
docker compose up -d mempool-db >/dev/null
# A new container, so nothing the old one cached about the old chain is left.
docker compose up -d --force-recreate -V mempool-api >/dev/null
docker compose up -d mempool-web >/dev/null

log "7. The block producer, then the bots"
docker compose up -d --force-recreate producer >/dev/null
for _ in $(seq 1 40); do
  [ "$(cli getblockcount)" -gt "$SETUP_BLOCKS" ] && break
  sleep 3
done
[ "$(cli getblockcount)" -gt "$SETUP_BLOCKS" ] || die "the producer made no block in two minutes"
tip_time=$(cli getblockheader "$(cli getbestblockhash)" | python3 -c 'import json,sys; print(json.load(sys.stdin)["time"])')
tip_age=$(( $(date +%s) - tip_time ))
[ "$tip_age" -ge -5 ] && [ "$tip_age" -le 120 ] || die "the producer's block is stamped $tip_age s before now: is the node still on the mock clock?"
# The bots make the faucet's wallet on their first start and fill it from the treasury.
docker compose up -d --force-recreate bots >/dev/null

log "8. Checks"
health=""
for _ in $(seq 1 40); do
  health=$(bots_get /health)
  [ -n "$health" ] && break
  sleep 3
done
[ -n "$health" ] || die "the bots do not answer (docker logs bots says why; the chain, the index and the producer are up)"
# The refill is in the first round of upkeep; it shows as coins on their way, then as coins.
for _ in $(seq 1 30); do
  health=$(bots_get /health)
  [ "$(faucet_coins "$health")" -gt 0 ] && break
  sleep 3
done
log "   bots: $health"
[ "$(faucet_coins "$health")" -gt 0 ] || warn "the faucet got no coins from the treasury: docker logs bots"
log "   pot:  $(bots_get /pot/stats)"
height=$(cli getblockcount)
log "   node height $height, index height $(index_height)"
wallets=$(cli listwallets | tr -d '\n ')
log "   wallets: $wallets"
[ "$wallets" = '["treasury","faucet"]' ] || warn "expected the wallets treasury and faucet, and no other"
electrum=$(electrum_height)
if [ "${electrum:-0}" -ge "$SETUP_BLOCKS" ] 2>/dev/null; then
  log "   Electrum height $electrum"
else
  warn "the index does not answer on its Electrum port (it says '$electrum'): docker logs electrs"
fi
# The explorer makes its database first and takes a minute or two.
explorer=""
for _ in $(seq 1 60); do
  explorer=$(explorer_height)
  [ "${explorer:-0}" -ge "$SETUP_BLOCKS" ] 2>/dev/null && break
  sleep 3
done
if [ "${explorer:-0}" -ge "$SETUP_BLOCKS" ] 2>/dev/null; then
  log "   explorer height $explorer"
else
  warn "the explorer does not show the new chain yet (it says '$explorer'): docker logs mempool-api"
fi
sudo rm -f "$MARK"
finished=1

echo
echo "The practice chain was reset. It was at height $old_height; it is at $height now."
[ "$warnings" -eq 0 ] || echo "$warnings thing(s) above need a look (LOOK AT THIS)."
echo
echo "The old data is in $KEEP . To go back to the old chain:"
go_back
echo "To free the space once the new chain has been looked at:  sudo rm -rf $KEEP"
