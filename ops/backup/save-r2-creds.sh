#!/usr/bin/env bash
# Saves the R2 token for the nightly backups as an rclone config (mode 600),
# then checks it can reach the bucket. Run it interactively over ssh -t; the
# secret is read with the input hidden and never printed.
#
#   ssh -t <practice server> /opt/learnbitcoin-practice/ops/backup/save-r2-creds.sh <cloudflare-account-id>
set -euo pipefail

ACCOUNT=${1:?pass the Cloudflare account ID (shown on the R2 overview page)}
BUCKET=${R2_BUCKET:-learnbitcoin-practice-backups}
CONF="$(cd "$(dirname "$0")/.." && pwd)/.rclone.conf"

read -r -p "R2 Access Key ID: " key_id
read -r -s -p "R2 Secret Access Key (input hidden): " secret
echo
if [ -z "$key_id" ] || [ -z "$secret" ]; then
  echo "Both values are needed; nothing saved." >&2
  exit 1
fi

umask 077
cat > "$CONF" <<EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = $key_id
secret_access_key = $secret
endpoint = https://$ACCOUNT.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
echo "Saved $CONF (mode 600). Checking the token..."

if rclone --config "$CONF" lsf "r2:$BUCKET" --max-depth 1 >/dev/null 2>&1; then
  echo "OK: the token reaches the bucket $BUCKET."
else
  echo "The token could not reach $BUCKET. Check the bucket name, that the token applies to it, and the account ID." >&2
  exit 1
fi
