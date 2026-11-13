#!/usr/bin/env bash
# Saves a Cloudflare tunnel token read from stdin to ops/.env.tunnel (mode
# 600), where the cloudflared service reads it as TUNNEL_TOKEN. Accepts the
# bare token or the whole "cloudflared ... --token ..." command Cloudflare
# shows. Prints only the tunnel ID the token belongs to, never the token.
#
#   pbpaste | ssh <droplet> /opt/learnbitcoin-practice/ops/save-tunnel-token.sh
set -euo pipefail
cd "$(dirname "$0")"

token=$(grep -oE 'eyJ[A-Za-z0-9+/=_-]+' | head -n 1 || true)
if [ -z "$token" ]; then
  echo "No tunnel token found in the input; nothing saved." >&2
  exit 1
fi

tunnel=$(printf '%s' "$token" | base64 -d 2>/dev/null | grep -oE '"t":"[0-9a-f-]{36}"' | cut -d'"' -f4 || true)
if [ -z "$tunnel" ]; then
  echo "That does not decode as a Cloudflare tunnel token; nothing saved." >&2
  exit 1
fi

umask 077
printf 'TUNNEL_TOKEN=%s\n' "$token" > .env.tunnel
echo "Saved the token for tunnel $tunnel to $(pwd)/.env.tunnel (mode 600)."
