# ops: the practice network

A private regtest chain on one small VPS: Bitcoin Core, electrs (Esplora REST
for the wallet, Electrum for Sparrow), a mempool explorer, the bots, and a
Cloudflare tunnel. Status: draft for spike S1, not deployed.

## What is reachable

| Name | Serves | Path |
|---|---|---|
| practice-electrum.learnbitcoin.com:50002 | Electrum over TLS (Sparrow, Electrum desktop) | DNS-only record to the droplet; electrum-tls (nginx stream) -> electrs:50001 |
| practice-explorer.learnbitcoin.com | mempool explorer, noindex | tunnel -> router:8082 -> mempool-web:8080 |
| practice-origin.learnbitcoin.com | Esplora REST and the bots API for the practice Worker only | tunnel -> router:8081, behind Cloudflare Access (service token) |
| ssh-practice.learnbitcoin.com | SSH for the operator | tunnel -> host:22, behind Cloudflare Access (service token) |

Published ports: 80 (ACME HTTP-01 only) and 50002. Docker-published ports
bypass the host firewall, so nothing else is published; the DigitalOcean cloud
firewall allows only these two. SSH has no public port: it runs only through
the tunnel, behind Cloudflare Access with a service token (Service Auth
policy). If Access ever fails, add an inbound rule for your current IP on
port 22 in the cloud firewall to get back in.

## First run (S1)

1. `ssh root@<ip> 'bash -s' < ops/bootstrap.sh`, then log in as `treib`.
2. Copy `ops/` to `/opt/learnbitcoin-practice/ops`; run `ops/make-secrets.sh`
   on the server. It writes `ops/.env` (mode 600): the MariaDB password and
   an `rpcauth` login each for mempool-api and the producer. electrs and
   `ops/cli.sh` use Core's cookie file, so there is no shared RPC password.
   (`--rotate` replaces the RPC logins.) The operator saves the tunnel token
   straight from the clipboard, without it passing through anything else:
   `pbpaste | ssh treib@<ip> /opt/learnbitcoin-practice/ops/save-tunnel-token.sh`
   (writes `ops/.env.tunnel`, prints only the tunnel ID).
3. `docker compose build bitcoind && docker compose up -d bitcoind`
4. Treasury: create the treasury wallet and mine the first ~5,000 blocks to it.
   Regtest halves the subsidy every 150 blocks, so this issues nearly all of
   the chain's ~15,000 practice BTC up front.
5. `docker compose up -d electrs mempool-db mempool-api mempool-web router cloudflared`
6. First certificate for practice-electrum.learnbitcoin.com (needs its DNS
   record and port 80 open): `sudo ops/certs/cert.sh issue`, then
   `docker compose up -d electrum-tls` (it cannot start without the
   certificate) and `sudo ops/certs/cert.sh install-timer` for renewals.
7. Bots: `sudo install -d -o 1000 -g 1000 /data/bots`, add `NTFY_TOPIC=` to
   `ops/.env` for alerts, then `docker compose build bots && docker compose up
   -d bots`. On first start they create the faucet wallet, refill it from the
   treasury and consolidate the treasury's small coins. See `bots/README.md`.

Interim kernel mitigation: `sudo bash ops/mitigations/cve-2026-98432.sh`
(applied 2026-11-13; removal steps in the script).

## Checks (spike S1, all run 2026-11-13)

- One block every 30 s (the producer); a 48-hour run is under way.
- Esplora REST and Electrum both serve a BIP84 wallet:
  `tools/integration/run-e2e.sh` and `tools/integration/electrum-check.ts`.
- The mempool frontend shows bcrt1 address and transaction pages.
- `generatetoaddress` honours `blockmaxweight`, and electrs and mempool follow
  an `invalidateblock` reorg: `tools/s1-checks/weight_and_reorg.py`.
- Pay it forward: `tools/integration/run-bots-e2e.sh`.
- A backup restores cleanly: `ops/backup/restore-drill.sh` (passed 2026-11-14).
- Still to do: Sparrow itself against the Electrum port.

## Backups

Nightly at 03:30 UTC (`ops/backup/backup.sh`, installed by
`sudo ops/backup/install-timer.sh`) to the R2 bucket
`learnbitcoin-practice-backups`, which has its own token, scoped to that
bucket only, and a lifecycle rule that deletes objects after 30 days.

- `chain/`: the regtest datadir, Core wallets included, copied at rest. The
  producer and bots pause for about half a minute, and the node for about 10
  seconds.
- `bots/`: the faucet's payout records (SQLite backup API).
- `manifests/`: height, tip and wallet balances at backup time.
- Not backed up: secrets (regenerate with `make-secrets.sh`, and fetch the
  tunnel token again from the dashboard), the electrs index and explorer
  database (they rebuild), and the certificate (re-issue).

Credentials: `ssh -t <server> ops/backup/save-r2-creds.sh <account-id>`
writes `ops/.rclone.conf` (mode 600) with hidden input. A failed backup
alerts the ntfy topic. To test a restore: `ops/backup/restore-drill.sh`.

## Cross-check without the VPS

`tools/regtest-crosscheck/run.sh` runs the wallet library against Bitcoin
Core in a throwaway, network-less container on a box that already has a
verified Core image. It passed on 2026-11-13 with Core 31.2.
