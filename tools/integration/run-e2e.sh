#!/usr/bin/env bash
# Runs tools/integration/e2e.ts against the live practice network over an SSH
# tunnel to the router's internal origin port (nothing new is exposed).
#
#   PRACTICE_SSH=treib@<server> tools/integration/run-e2e.sh
set -euo pipefail

TARGET=${PRACTICE_SSH:?set PRACTICE_SSH to the ssh target of the practice server}
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${E2E_LOCAL_PORT:-18081}
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=20 -o ControlMaster=auto -o ControlPath=/tmp/lbp-e2e-%C -o ControlPersist=120"

cleanup() { ssh $SSH_OPTS -O exit "$TARGET" 2>/dev/null || true; }
trap cleanup EXIT

ROUTER=$(ssh $SSH_OPTS "$TARGET" 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" router')
ssh $SSH_OPTS -O forward -L "$PORT:$ROUTER:8081" "$TARGET"

ESPLORA_URL="http://127.0.0.1:$PORT/esplora" PRACTICE_SSH="$TARGET" SSH_OPTS="$SSH_OPTS" \
  node "$HERE/e2e.ts"
