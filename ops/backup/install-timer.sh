#!/usr/bin/env bash
# Installs the nightly backup as a systemd timer (03:30 UTC). Run with sudo.
set -euo pipefail

cat > /etc/systemd/system/practice-backup.service <<'EOF'
[Unit]
Description=Nightly backup of the practice network to R2
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=treib
ExecStart=/opt/learnbitcoin-practice/ops/backup/backup.sh
EOF

cat > /etc/systemd/system/practice-backup.timer <<'EOF'
[Unit]
Description=Nightly backup of the practice network to R2

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now practice-backup.timer
systemctl list-timers practice-backup.timer --no-pager | sed -n '1,2p'
