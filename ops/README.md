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
firewall allows only these two (and SSH from the operator's IP until SSH moves
to Cloudflare Access).

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
   record and port 80 open): certbot with the webroot `ops/nginx/acme`, into
   /data/letsencrypt; then `docker compose up -d electrum-tls`, which cannot
   start without it.

Interim kernel mitigation: `sudo bash ops/mitigations/cve-2026-98432.sh`
(applied 2026-11-13; removal steps in the script).

## S1 checks

- One block every 30 s for 48 h (bots/producer).
- Esplora REST and Electrum both serve a BIP84 wallet; the wallet package's
  scan and send work against it end to end.
- Sparrow restores the same 12 words (and whether Tools > Restart In offers
  Regtest, or readers need `-n regtest`).
- The mempool frontend shows bcrt1 address pages and a queued transaction.
- `generatetoaddress` honours `blockmaxweight`.
- electrs and mempool follow an `invalidateblock` reorg.
- A backup restores cleanly.

## Cross-check without the VPS

`tools/regtest-crosscheck/run.sh` runs the wallet library against Bitcoin
Core in a throwaway, network-less container on a box that already has a
verified Core image. It passed on 2026-11-13 with Core 31.2.
