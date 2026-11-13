# ops: the practice network

A private regtest chain on one small VPS: Bitcoin Core, electrs (Esplora REST
for the wallet, Electrum for Sparrow), a mempool explorer, the bots, and a
Cloudflare tunnel. Status: draft for spike S1, not deployed.

## What is reachable

| Name | Serves | Path |
|---|---|---|
| practice-electrum.learnbitcoin.com:50002 | Electrum over TLS (Sparrow, Electrum desktop) | DNS-only record to the droplet; nginx stream -> electrs:50001 |
| practice-explorer.learnbitcoin.com | mempool explorer, noindex | tunnel -> mempool-web:8080 |
| practice-origin.learnbitcoin.com | Esplora REST and the bots API for the practice Worker only | tunnel -> router:8081, behind Cloudflare Access (service token) |

Published ports: 80 (ACME HTTP-01 only) and 50002. Docker-published ports
bypass the host firewall, so nothing else is published; the DigitalOcean cloud
firewall allows only these two (and SSH from the operator's IP until SSH moves
to Cloudflare Access).

## First run (S1)

1. `ssh root@<ip> 'bash -s' < ops/bootstrap.sh`, then log in as `treib`.
2. Copy `ops/` to `/opt/learnbitcoin-practice/ops`; create `ops/.env` with
   `BITCOIN_RPC_USER`, `BITCOIN_RPC_PASSWORD`, `MARIADB_PASSWORD` (random)
   and `CLOUDFLARE_TUNNEL_TOKEN` (the operator pastes it; never in git).
3. `docker compose build bitcoind && docker compose up -d bitcoind`
4. Treasury: create the treasury wallet and mine the first ~5,000 blocks to it.
   Regtest halves the subsidy every 150 blocks, so this issues nearly all of
   the chain's ~15,000 practice BTC up front.
5. `docker compose up -d electrs mempool-db mempool-api mempool-web cloudflared`
6. First certificate, before the router starts (nginx cannot load the
   Electrum listener without one): certbot `--standalone` on port 80 for
   practice-electrum.learnbitcoin.com into /data/letsencrypt; then
   `docker compose up -d router`. Renewals use the webroot at
   `ops/nginx/acme`.

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
