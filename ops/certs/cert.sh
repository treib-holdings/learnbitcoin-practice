#!/usr/bin/env bash
# The Let's Encrypt certificate for practice-electrum.learnbitcoin.com, the
# Electrum-over-TLS port (50002). HTTP-01 through the router on port 80, so no
# DNS API token ever lives on this server. Registered without an email.
#
#   ops/certs/cert.sh issue           first certificate (then start electrum-tls)
#   ops/certs/cert.sh renew           renew if due, reload electrum-tls
#   ops/certs/cert.sh install-timer   systemd timer: renew twice a day
set -euo pipefail

DOMAIN=practice-electrum.learnbitcoin.com
OPS=/opt/learnbitcoin-practice/ops
CERTBOT=certbot/certbot:v5.1.0

certbot() {
  docker run --rm \
    -v /data/letsencrypt:/etc/letsencrypt \
    -v "$OPS/nginx/acme:/var/www/acme" \
    "$CERTBOT" "$@"
}

case "${1:-}" in
  issue)
    certbot certonly --webroot -w /var/www/acme -d "$DOMAIN" \
      --agree-tos --register-unsafely-without-email --non-interactive
    ;;
  renew)
    certbot renew --webroot -w /var/www/acme --quiet
    if docker ps --format '{{.Names}}' | grep -qx electrum-tls; then
      docker exec electrum-tls nginx -s reload
    fi
    ;;
  install-timer)
    cat > /etc/systemd/system/practice-cert-renew.service <<EOF
[Unit]
Description=Renew the practice-electrum TLS certificate
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=$OPS/certs/cert.sh renew
EOF
    cat > /etc/systemd/system/practice-cert-renew.timer <<'EOF'
[Unit]
Description=Renew the practice-electrum TLS certificate twice a day

[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now practice-cert-renew.timer
    systemctl list-timers practice-cert-renew.timer --no-pager | head -2
    ;;
  *)
    echo "usage: $0 issue|renew|install-timer" >&2
    exit 2
    ;;
esac
