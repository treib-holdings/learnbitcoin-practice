"""Start the bots: wait for the node, open the wallets, run upkeep every minute, serve the API."""

import threading
import time
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer

from . import config
from .alerts import Alerter
from .bots import Bots
from .rpc import RPC
from .server import make_handler
from .store import Store

UPKEEP_SECONDS = 60


def log(message: str) -> None:
    print(f"{datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ} {message}", flush=True)


def wait_for_node(rpc: RPC) -> None:
    while True:
        try:
            log(f"node at height {rpc.call('getblockcount')}")
            return
        except Exception as e:
            log(f"waiting for the node: {e}")
            time.sleep(5)


def upkeep_loop(bots: Bots, alerter: Alerter) -> None:
    while True:
        try:
            done = {k: v for k, v in bots.maintain().items() if v}
            if done:
                log(f"upkeep: {done}")
        except Exception as e:
            log(f"upkeep failed: {e}")
        try:
            alerter.update(bots.problems(bots.health()))
        except Exception as e:
            log(f"health check failed: {e}")
        time.sleep(UPKEEP_SECONDS)


def main() -> None:
    cfg = config.load()
    rpc = RPC(cfg.rpc_url, cfg.rpc_user, cfg.rpc_password)
    wait_for_node(rpc)
    bots = Bots(cfg, rpc, Store(cfg.db_path))
    bots.ensure_wallets()
    alerter = Alerter(cfg.ntfy_topic, log=log)
    threading.Thread(target=upkeep_loop, args=(bots, alerter), daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", cfg.port), make_handler(bots, cfg.api_token, log=log))
    log(f"api on :{cfg.port}; alerts {'on' if cfg.ntfy_topic else 'off (no NTFY_TOPIC)'}")
    server.serve_forever()
