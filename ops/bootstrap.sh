#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 droplet that will run the practice
# network. Run as root over SSH, once, after reading it:
#
#   ssh root@<droplet-ip> 'bash -s' < ops/bootstrap.sh
#
# What it does: updates the system, turns on unattended security upgrades,
# creates the "treib" admin user with root's SSH key, turns off password and
# root SSH logins, installs Docker from Docker's signed apt repository, and
# makes the data directories. It opens no ports: the DigitalOcean cloud
# firewall decides what is reachable.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
timedatectl set-timezone UTC

apt-get update
apt-get -y -o Dpkg::Options::=--force-confold upgrade
apt-get -y install ca-certificates curl gnupg unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# Admin user with the same key root was given at droplet creation.
if ! id treib >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" treib
  usermod -aG sudo treib
  echo 'treib ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-treib
  chmod 440 /etc/sudoers.d/90-treib
fi
install -d -m 700 -o treib -g treib /home/treib/.ssh
install -m 600 -o treib -g treib /root/.ssh/authorized_keys /home/treib/.ssh/authorized_keys

# SSH: keys only, no root.
# 00- so it is read first: sshd keeps the first value it sees, and cloud-init
# may write 50-cloud-init.conf with PasswordAuthentication yes.
cat > /etc/ssh/sshd_config.d/00-practice-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sshd -t
systemctl reload ssh
sshd -T | grep -E "^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) "

# Docker from Docker's own signed repository.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker treib

# Data directories (uid 1000 matches the bitcoind and electrs containers).
install -d -o 1000 -g 1000 /data/bitcoin /data/electrs
install -d /data/mempool-db /data/letsencrypt /opt/learnbitcoin-practice
chown treib:treib /opt/learnbitcoin-practice

# 2 GB swap as a cushion on a 4 GB droplet.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "bootstrap done: log in as treib from now on"
