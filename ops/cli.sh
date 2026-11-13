#!/usr/bin/env bash
# bitcoin-cli for the practice node, authenticated by Core's cookie file
# inside the bitcoind container (no password anywhere). Examples:
#   ops/cli.sh getblockchaininfo
#   ops/cli.sh -rpcwallet=treasury getbalances
exec docker exec -i bitcoind bitcoin-cli -conf=/data/bitcoin/bitcoin.conf -datadir=/data/bitcoin "$@"
