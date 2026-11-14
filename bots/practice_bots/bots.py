"""What the bots do with the node's wallets.

treasury  every practice coin starts here (mined at setup). The bots keep it
          tidy by consolidating its many small late-issuance coinbase coins.
faucet    pays a fixed amount to a learner. It also holds the pay-it-forward
          pot: coins learners send to "pot" addresses. A faucet payment spends
          the OLDEST pot coin first, so a newcomer's first coin traces on the
          explorer to a real earlier learner's payment. Pot coins stay locked
          until then, so the wallet never spends them by accident.
refill    when the faucet's own coins run low, the treasury sends it a batch
          of medium coins, so faucet payments need one or two inputs.
"""

import os
import threading
import time
import urllib.request

from .rpc import RPCError, to_btc, to_sats


class FaucetError(Exception):
    """A refusal the caller can act on. `code` is stable and machine-readable
    (the app shows its own text for it, in the reader's language); `message`
    is for logs and for people calling the API by hand."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _outpoint(coin: dict) -> dict:
    return {"txid": coin["txid"], "vout": coin["vout"]}


class Bots:
    def __init__(self, cfg, rpc, store, clock=time.time, fetch=None):
        self.cfg = cfg
        self.node = rpc
        self.treasury = rpc.with_wallet("treasury")
        self.faucet = rpc.with_wallet("faucet")
        self.store = store
        self.clock = clock
        self.fetch = fetch or (lambda url: urllib.request.urlopen(url, timeout=10).read().decode())
        self.lock = threading.Lock()  # one wallet-changing operation at a time
        self.last_consolidation: str | None = None
        self._pot_address: str | None = None  # handed out until it is paid

    # -- setup ----------------------------------------------------------------

    def ensure_wallets(self) -> None:
        loaded = set(self.node.call("listwallets"))
        if "treasury" not in loaded:
            self.node.call("loadwallet", "treasury")  # created at setup; must exist
        if "faucet" not in loaded:
            try:
                self.node.call("loadwallet", "faucet")
            except RPCError:
                self.node.call("createwallet", wallet_name="faucet", load_on_startup=True)

    # -- the pot --------------------------------------------------------------

    def pot_addresses(self) -> set:
        try:
            return set(self.faucet.call("getaddressesbylabel", "pot"))
        except RPCError as e:
            if e.code == -11:  # no address has that label yet
                return set()
            raise

    def pot_coins(self) -> list:
        """Confirmed, unspent pot coins, oldest first (locked or not)."""
        addresses = self.pot_addresses()
        if not addresses:
            return []
        coins = {}
        for u in self.faucet.call("listunspent", 1, 9999999, sorted(addresses)):
            coins[(u["txid"], u["vout"])] = {
                "txid": u["txid"], "vout": u["vout"], "sats": to_sats(u["amount"]), "confirmations": u["confirmations"],
            }
        for o in self.faucet.call("listlockunspent"):
            if (o["txid"], o["vout"]) in coins:
                continue
            out = self.node.call("gettxout", o["txid"], o["vout"], False)
            if not out or out["confirmations"] < 1 or out["scriptPubKey"].get("address") not in addresses:
                continue
            coins[(o["txid"], o["vout"])] = {
                "txid": o["txid"], "vout": o["vout"], "sats": to_sats(out["value"]), "confirmations": out["confirmations"],
            }
        return sorted(coins.values(), key=lambda c: (-c["confirmations"], c["txid"], c["vout"]))

    def pot_address(self) -> dict:
        """The pot's current address. Everyone who asks gets the same one until
        somebody pays it; only then is a new one made. So asking is free: it
        cannot grow the node's wallet, however often it is called."""
        with self.lock:
            if self._pot_address is None:
                self._pot_address = self._unpaid_pot_address()
            elif self.faucet.call("getreceivedbyaddress", self._pot_address, 0) > 0:
                self._pot_address = self.faucet.call("getnewaddress", "pot", "bech32")
            return {"address": self._pot_address}

    def _unpaid_pot_address(self) -> str:
        """After a restart: a pot address that was never paid, or a new one if there is none."""
        for entry in self.faucet.call("listreceivedbyaddress", 0, True, False):
            if entry.get("label") == "pot" and not entry.get("txids") and not entry.get("amount"):
                return entry["address"]
        return self.faucet.call("getnewaddress", "pot", "bech32")

    def pot_stats(self) -> dict:
        received = [
            r for r in self.faucet.call("listreceivedbyaddress", 1, False, False) if r.get("label") == "pot"
        ]
        txids = {t for r in received for t in r.get("txids", [])}
        return {
            "learners_passed_on": len(txids),
            "sats_received": sum(to_sats(r["amount"]) for r in received),
            "coins_waiting": len(self.pot_coins()),
            "coins_passed_to_newcomers": self.store.passed_on(),
            "faucet_payments": self.store.total(),
        }

    def _lock_new_pot_coins(self) -> int:
        addresses = self.pot_addresses()
        if not addresses:
            return 0
        unlocked = [_outpoint(u) for u in self.faucet.call("listunspent", 0, 9999999, sorted(addresses))]
        if unlocked:
            self.faucet.call("lockunspent", False, unlocked, True)
        return len(unlocked)

    # -- the faucet -----------------------------------------------------------

    def _check_address(self, address: str) -> None:
        if not address or len(address) > 100:
            raise FaucetError(400, "bad_address", "Send a practice-network address")
        info = self.node.call("validateaddress", address)
        if not info.get("isvalid") or not address.startswith("bcrt1"):
            raise FaucetError(400, "bad_address", "That is not a practice-network address (they start with bcrt1)")
        for wallet in (self.faucet, self.treasury):
            if wallet.call("getaddressinfo", address).get("ismine"):
                raise FaucetError(400, "own_address", "That address belongs to the practice network's own wallets")

    def pay(self, address: str) -> dict:
        """Pay one faucet amount to a learner's address, spending the oldest pot coin first."""
        with self.lock:
            self._check_address(address)
            now = int(self.clock())
            last = self.store.last_payout_to(address)
            if last is not None and now - last < self.cfg.per_address_hours * 3600:
                raise FaucetError(429, "already_paid", "This address already got practice coins today")
            if self.store.payouts_since(now - 60) >= self.cfg.per_minute:
                raise FaucetError(429, "busy", "The faucet is busy; try again in a minute")

            pot = next(iter(self.pot_coins()), None)
            options = {"add_inputs": True, "replaceable": True}
            if pot:
                try:
                    self.faucet.call("lockunspent", True, [_outpoint(pot)])
                except RPCError as e:
                    if e.code != -8:  # -8: it was not locked yet, which is fine
                        raise
                options["inputs"] = [_outpoint(pot)]
            try:
                result = self.faucet.call(
                    "send",
                    outputs=[{address: to_btc(self.cfg.faucet_sats)}],
                    fee_rate=self.cfg.fee_rate,
                    options=options,
                )
            except RPCError as e:
                if pot:
                    self.faucet.call("lockunspent", False, [_outpoint(pot)], True)
                if e.code == -6:  # insufficient funds: a refill is on its way
                    raise FaucetError(503, "refilling", "The faucet is refilling; try again in a minute") from None
                raise
            if not result.get("complete") or not result.get("txid"):
                raise FaucetError(500, "failed", "The faucet could not finish that payment")
            self.store.record(address, result["txid"], self.cfg.faucet_sats, pot, now)
            return {
                "txid": result["txid"],
                "amount_sats": self.cfg.faucet_sats,
                "pot_coin": {"txid": pot["txid"], "vout": pot["vout"], "sats": pot["sats"]} if pot else None,
            }

    def faucet_own_sats(self) -> int:
        """Confirmed faucet coins that are not pot coins."""
        pot = {(c["txid"], c["vout"]) for c in self.pot_coins()}
        return sum(
            to_sats(u["amount"]) for u in self.faucet.call("listunspent", 1) if (u["txid"], u["vout"]) not in pot
        )

    # -- upkeep ---------------------------------------------------------------

    def _refill_if_low(self) -> str | None:
        pending = to_sats(self.faucet.call("getbalances")["mine"]["untrusted_pending"])
        if pending > 0 or self.faucet_own_sats() >= self.cfg.refill_low_sats:
            return None
        amounts = {
            self.faucet.call("getnewaddress", "refill", "bech32"): to_btc(self.cfg.refill_coin_sats)
            for _ in range(self.cfg.refill_coins)
        }
        return self.treasury.call("sendmany", dummy="", amounts=amounts, fee_rate=self.cfg.fee_rate)

    def _consolidate_batch(self) -> str | None:
        if self.last_consolidation:
            try:
                self.node.call("getmempoolentry", self.last_consolidation)
                return None  # the previous one has not confirmed yet
            except RPCError:
                self.last_consolidation = None
        small = [
            u for u in self.treasury.call("listunspent", 1)
            if self.cfg.consolidate_min_sats <= to_sats(u["amount"]) <= self.cfg.consolidate_max_sats
        ]
        if len(small) < 50:
            return None
        batch = sorted(small, key=lambda u: (to_sats(u["amount"]), u["txid"], u["vout"]))[: self.cfg.consolidate_batch]
        destination = self.treasury.call("getnewaddress", "consolidated", "bech32")
        result = self.treasury.call(
            "sendall", recipients=[destination], fee_rate=1, options={"inputs": [_outpoint(u) for u in batch]}
        )
        self.last_consolidation = result.get("txid")
        return self.last_consolidation

    def maintain(self) -> dict:
        with self.lock:
            return {
                "pot_coins_locked": self._lock_new_pot_coins(),
                "refill_txid": self._refill_if_low(),
                "consolidation_txid": self._consolidate_batch(),
            }

    # -- health ---------------------------------------------------------------

    def health(self) -> dict:
        info = self.node.call("getblockchaininfo")
        tip_time = self.node.call("getblockheader", info["bestblockhash"])["time"]
        try:
            esplora_tip = int(self.fetch(f"{self.cfg.esplora_url}/blocks/tip/height").strip())
        except Exception:
            esplora_tip = None
        disk = os.statvfs(self.cfg.disk_path)
        used = 1 - disk.f_bavail / disk.f_blocks if disk.f_blocks else 0.0
        return {
            "height": info["blocks"],
            "block_age_seconds": int(self.clock()) - tip_time,
            "esplora_height": esplora_tip,
            "faucet_sats": self.faucet_own_sats(),
            "faucet_pending_sats": to_sats(self.faucet.call("getbalances")["mine"]["untrusted_pending"]),
            "disk_used_pct": round(used * 100, 1),
        }

    def problems(self, h: dict) -> dict:
        """Each named condition: a message while it is wrong, None when it is fine."""
        lag = None if h["esplora_height"] is None else h["height"] - h["esplora_height"]
        return {
            "blocks": f"No new block for {h['block_age_seconds'] // 60} min (is the producer running?)"
            if h["block_age_seconds"] > self.cfg.block_stale_seconds else None,
            "electrs": "electrs is not answering" if lag is None
            else (f"electrs is {lag} blocks behind the node" if lag > 3 else None),
            # A refill on its way (unconfirmed) is not a problem.
            "faucet": f"The faucet holds {h['faucet_sats']:,} sats; refills may be failing"
            if h["faucet_sats"] + h.get("faucet_pending_sats", 0) < self.cfg.faucet_sats * 10 else None,
            "disk": f"Disk {h['disk_used_pct']}% full" if h["disk_used_pct"] > 85 else None,
        }
