#!/bin/sh
# The practice network's block producer (stopgap until the bots service):
# one block every INTERVAL seconds, paid to the treasury wallet, so a reader's
# payment confirms in under a minute. Fees go back to the treasury.
#
# The reward goes to a new address of the treasury every ROTATE blocks. Paid
# to one address for good, 2,880 rewards a day would make that address's
# history grow without end, and Esplora reads down an address's whole
# history to answer some questions about it.
set -eu
INTERVAL=${INTERVAL:-30}
ROTATE=${ROTATE:-100}

cli() {
  bitcoin-cli -regtest -rpcconnect=bitcoind -rpcport=18443 \
    -rpcuser=producer -rpcpassword="$PRODUCER_RPC_PASSWORD" "$@"
}

cli -rpcwait getblockcount >/dev/null
cli loadwallet treasury >/dev/null 2>&1 || true
echo "producer: a block every ${INTERVAL}s, a new reward address every ${ROTATE} blocks"

mined=0
while true; do
  if [ $((mined % ROTATE)) -eq 0 ]; then
    address=$(cli -rpcwallet=treasury getnewaddress producer bech32)
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rewards go to $address"
  fi
  if hash=$(cli generatetoaddress 1 "$address" 2>&1); then
    mined=$((mined + 1))
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $(echo "$hash" | tr -d ' []"\n')"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) mining failed: $hash" >&2
  fi
  sleep "$INTERVAL"
done
