#!/bin/sh
# The practice network's block producer (stopgap until the bots service):
# one block every INTERVAL seconds, paid to the treasury wallet, so a reader's
# payment confirms in under a minute. Fees go back to the treasury.
set -eu
INTERVAL=${INTERVAL:-30}

cli() {
  bitcoin-cli -regtest -rpcconnect=bitcoind -rpcport=18443 \
    -rpcuser=producer -rpcpassword="$PRODUCER_RPC_PASSWORD" "$@"
}

cli -rpcwait getblockcount >/dev/null
cli loadwallet treasury >/dev/null 2>&1 || true
address=$(cli -rpcwallet=treasury getnewaddress producer bech32)
echo "producer: a block every ${INTERVAL}s to $address"

while true; do
  if hash=$(cli generatetoaddress 1 "$address" 2>&1); then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $(echo "$hash" | tr -d ' []"\n')"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) mining failed: $hash" >&2
  fi
  sleep "$INTERVAL"
done
