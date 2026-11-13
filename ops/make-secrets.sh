#!/usr/bin/env bash
# Writes ops/.env (mode 600) on the server. Prints only the variable names.
#
# Bitcoin Core RPC has no shared password:
#   - electrs and ops/cli.sh use Core's cookie file (nothing to leak in logs)
#   - mempool-api and the producer each get their own rpcauth login
#     (Core stores only a salted HMAC; the password lives only in .env)
#
#   ops/make-secrets.sh            create .env if missing (keeps an existing one)
#   ops/make-secrets.sh --rotate   new RPC logins, keeps MARIADB_PASSWORD
set -euo pipefail
cd "$(dirname "$0")"
umask 077

rotate=false
[ "${1:-}" = "--rotate" ] && rotate=true
if [ -f .env ] && [ "$rotate" = false ]; then
  echo ".env exists; use --rotate for new RPC logins"
  cut -d= -f1 .env
  exit 0
fi

mariadb=$(grep -E '^MARIADB_PASSWORD=' .env 2>/dev/null | cut -d= -f2- || true)
[ -n "$mariadb" ] || mariadb=$(openssl rand -hex 32)

# Prints "user:salt$hmac" then the password, as Bitcoin Core's share/rpcauth/rpcauth.py does.
rpcauth() {
  python3 - "$1" <<'PY'
import hmac, secrets, sys
user = sys.argv[1]
salt = secrets.token_hex(16)
password = secrets.token_hex(32)
print(f"{user}:{salt}${hmac.new(salt.encode(), password.encode(), 'sha256').hexdigest()}")
print(password)
PY
}

{ read -r mempool_auth; read -r mempool_pw; } < <(rpcauth mempool)
{ read -r producer_auth; read -r producer_pw; } < <(rpcauth producer)

# Single quotes: compose must not read the "$" in rpcauth values as variables.
cat > .env.new <<EOF
MARIADB_PASSWORD=$mariadb
RPCAUTH_MEMPOOL='$mempool_auth'
MEMPOOL_RPC_PASSWORD=$mempool_pw
RPCAUTH_PRODUCER='$producer_auth'
PRODUCER_RPC_PASSWORD=$producer_pw
EOF
mv .env.new .env
echo "wrote .env:"
cut -d= -f1 .env
