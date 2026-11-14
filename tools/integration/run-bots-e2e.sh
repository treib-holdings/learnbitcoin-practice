#!/usr/bin/env bash
# Runs tools/integration/bots-e2e.ts against the live practice network over an
# SSH tunnel to the router's origin port. The bots' API token is read from the
# server into this process's environment only; it is never printed.
#
#   PRACTICE_SSH=<ssh alias of the practice server> tools/integration/run-bots-e2e.sh
set -euo pipefail

TARGET=${PRACTICE_SSH:?set PRACTICE_SSH to the ssh target of the practice server}
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${E2E_LOCAL_PORT:-18083}
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=30 -o ControlMaster=auto -o ControlPath=/tmp/lbp-bots-%C -o ControlPersist=120"

cleanup() { ssh $SSH_OPTS -O exit "$TARGET" 2>/dev/null || true; }
trap cleanup EXIT

ROUTER=$(ssh $SSH_OPTS "$TARGET" 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" router')
ssh $SSH_OPTS -O forward -L "$PORT:$ROUTER:8081" "$TARGET"
BOTS_API_TOKEN=$(ssh $SSH_OPTS "$TARGET" "grep -E '^BOTS_API_TOKEN=' /opt/learnbitcoin-practice/ops/.env | cut -d= -f2-")
export BOTS_API_TOKEN

ESPLORA_URL="http://127.0.0.1:$PORT/esplora" BOTS_URL="http://127.0.0.1:$PORT/bots" node "$HERE/bots-e2e.ts"
