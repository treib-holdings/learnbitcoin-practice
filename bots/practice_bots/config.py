"""Settings, from the environment (ops/compose.yaml and ops/.env)."""

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass(frozen=True)
class Config:
    rpc_url: str
    rpc_user: str
    rpc_password: str
    api_token: str
    esplora_url: str
    ntfy_topic: str
    db_path: str
    disk_path: str
    port: int
    faucet_sats: int  # what one faucet request pays
    fee_rate: int  # sat/vB for faucet payments and refills
    refill_low_sats: int  # refill the faucet when its own coins drop below this
    refill_coins: int  # a refill sends this many coins...
    refill_coin_sats: int  # ...of this size, so faucet payments need few inputs
    per_address_hours: int  # one faucet payment per address per this many hours
    per_minute: int  # faucet payments per minute, all addresses together
    consolidate_min_sats: int  # treasury coins worth consolidating: at least this...
    consolidate_max_sats: int  # ...and at most this
    consolidate_batch: int  # inputs per consolidation transaction
    block_stale_seconds: int  # alert when the newest block is older than this


def load() -> Config:
    return Config(
        rpc_url=os.environ.get("RPC_URL", "http://bitcoind:18443"),
        rpc_user=os.environ.get("RPC_USER", "bots"),
        rpc_password=os.environ["BOTS_RPC_PASSWORD"],
        api_token=os.environ["BOTS_API_TOKEN"],
        esplora_url=os.environ.get("ESPLORA_URL", "http://electrs:3000"),
        ntfy_topic=os.environ.get("NTFY_TOPIC", ""),
        db_path=os.environ.get("DB_PATH", "/data/bots/bots.db"),
        disk_path=os.environ.get("DISK_PATH", "/data/bots"),
        port=_int("PORT", 8080),
        faucet_sats=_int("FAUCET_SATS", 100_000),
        fee_rate=_int("FEE_RATE", 2),
        refill_low_sats=_int("REFILL_LOW_SATS", 200_000_000),
        refill_coins=_int("REFILL_COINS", 20),
        refill_coin_sats=_int("REFILL_COIN_SATS", 50_000_000),
        per_address_hours=_int("PER_ADDRESS_HOURS", 24),
        per_minute=_int("PER_MINUTE", 20),
        consolidate_min_sats=_int("CONSOLIDATE_MIN_SATS", 100),
        consolidate_max_sats=_int("CONSOLIDATE_MAX_SATS", 1_000_000),
        consolidate_batch=_int("CONSOLIDATE_BATCH", 500),
        block_stale_seconds=_int("BLOCK_STALE_SECONDS", 180),
    )
