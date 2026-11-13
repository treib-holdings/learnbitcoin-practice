#!/usr/bin/env bash
# bitcoin-cli for the practice node, using the credentials the bitcoind
# container already has. Examples:
#   ops/cli.sh getblockchaininfo
#   ops/cli.sh -rpcwallet=treasury getbalances
exec docker exec -i bitcoind sh -c \
  'exec bitcoin-cli -conf=/data/bitcoin/bitcoin.conf -datadir=/data/bitcoin -rpcuser="$BITCOIN_RPC_USER" -rpcpassword="$BITCOIN_RPC_PASSWORD" "$@"' \
  bitcoin-cli "$@"
