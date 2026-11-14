#!/usr/bin/env bash
# Writes ops/.env (mode 600) on the server. Prints only the variable names.
#
# Bitcoin Core RPC has no shared password:
#   - electrs and ops/cli.sh use Core's cookie file (nothing to leak in logs)
#   - mempool-api, the producer and the bots each get their own rpcauth login
#     (Core stores only a salted HMAC; the password lives only in .env)
#
#   ops/make-secrets.sh            add whatever is missing, keep everything else
#   ops/make-secrets.sh --rotate   new RPC logins for every service; keeps the
#                                  MariaDB password, the bots API token and any
#                                  other entries (such as NTFY_TOPIC)
set -euo pipefail
cd "$(dirname "$0")"
umask 077
exec python3 - "$@" <<'PY'
import hmac
import os
import secrets
import sys

rotate = "--rotate" in sys.argv[1:]
services = ["mempool", "producer", "bots"]

entries = {}
if os.path.exists(".env"):
    for line in open(".env"):
        line = line.rstrip("\n")
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            entries[key] = value.strip("'")


def rpcauth(user):
    """As Bitcoin Core's share/rpcauth/rpcauth.py: user:salt$hmac, plus the password."""
    salt = secrets.token_hex(16)
    password = secrets.token_hex(32)
    return f"{user}:{salt}${hmac.new(salt.encode(), password.encode(), 'sha256').hexdigest()}", password


entries.setdefault("MARIADB_PASSWORD", secrets.token_hex(32))
for service in services:
    auth_key, password_key = f"RPCAUTH_{service.upper()}", f"{service.upper()}_RPC_PASSWORD"
    if rotate or auth_key not in entries or password_key not in entries:
        entries[auth_key], entries[password_key] = rpcauth(service)
entries.setdefault("BOTS_API_TOKEN", secrets.token_urlsafe(32))

with open(".env.new", "w") as f:
    for key, value in entries.items():
        # Single quotes keep compose from reading the "$" in rpcauth values as a variable.
        f.write(f"{key}='{value}'\n" if key.startswith("RPCAUTH_") else f"{key}={value}\n")
os.replace(".env.new", ".env")
print("wrote .env:")
for key in entries:
    print(key)
PY
