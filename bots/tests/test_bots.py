"""Unit tests for the bots' decisions, against a fake node. Run: python3 -m unittest discover -s bots/tests"""

import os
import sys
import tempfile
import unittest
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from practice_bots.alerts import Alerter  # noqa: E402
from practice_bots.bots import Bots, FaucetError  # noqa: E402
from practice_bots.config import Config  # noqa: E402
from practice_bots.rpc import RPCError, to_btc, to_sats  # noqa: E402
from practice_bots.store import Store  # noqa: E402

LEARNER = "bcrt1qt0y43jtzaw329xh45m6w03r2h2k5myvmurtfgr"
POT_ADDR = "bcrt1qpot0000000000000000000000000000000000"


def cfg(**over):
    base = dict(
        rpc_url="http://x", rpc_user="bots", rpc_password="p", api_token="t", esplora_url="http://e",
        ntfy_topic="", db_path=":memory:", disk_path=tempfile.gettempdir(), port=0,
        faucet_sats=100_000, fee_rate=2, refill_low_sats=200_000_000, refill_coins=20, refill_coin_sats=50_000_000,
        per_address_hours=24, per_minute=20, consolidate_min_sats=100, consolidate_max_sats=1_000_000,
        consolidate_batch=500, block_stale_seconds=180,
    )
    base.update(over)
    return Config(**base)


class FakeNode:
    """Answers RPC calls from a handler table keyed by (wallet, method); records every call."""

    def __init__(self, wallet=None, shared=None):
        self.wallet = wallet
        self.shared = shared if shared is not None else {"calls": [], "handlers": {}}

    def with_wallet(self, name):
        return FakeNode(name, self.shared)

    def on(self, wallet, method, fn):
        self.shared["handlers"][(wallet, method)] = fn

    def calls(self, method):
        return [c for c in self.shared["calls"] if c[1] == method]

    def call(self, method, *params, **named):
        self.shared["calls"].append((self.wallet, method, params, named))
        handler = self.shared["handlers"].get((self.wallet, method))
        if handler is None:
            raise AssertionError(f"unexpected call: wallet={self.wallet} {method} {params} {named}")
        return handler(*params, **named)


def make(now=1_000_000, **over):
    node = FakeNode()
    node.on(None, "validateaddress", lambda a: {"isvalid": a.startswith("bcrt1")})
    for w in ("faucet", "treasury"):
        node.on(w, "getaddressinfo", lambda a: {"ismine": a == POT_ADDR})
    node.on("faucet", "getaddressesbylabel", lambda label: {POT_ADDR: {"purpose": "receive"}})
    node.on("faucet", "listunspent", lambda *a: [])
    node.on("faucet", "listlockunspent", lambda: [])
    node.on("faucet", "lockunspent", lambda *a: True)
    node.on("faucet", "send", lambda **kw: {"complete": True, "txid": "ff" * 32})
    clock = {"now": now}
    bots = Bots(cfg(**over), node, Store(":memory:"), clock=lambda: clock["now"], fetch=lambda url: "105")
    return bots, node, clock


def pot_coin(txid, confs, sats=30_000, vout=0):
    return {"txid": txid, "vout": vout, "amount": Decimal(to_btc(sats)), "confirmations": confs, "address": POT_ADDR}


class AmountTests(unittest.TestCase):
    def test_round_trip(self):
        self.assertEqual(to_btc(100_000), "0.00100000")
        self.assertEqual(to_btc(1_234_567_890), "12.34567890")
        self.assertEqual(to_sats(Decimal("0.00100000")), 100_000)


class FaucetTests(unittest.TestCase):
    def test_spends_the_oldest_pot_coin_first(self):
        bots, node, _ = make()
        node.on("faucet", "listunspent", lambda *a: [pot_coin("aa" * 32, 3), pot_coin("bb" * 32, 9)])
        result = bots.pay(LEARNER)
        send = node.calls("send")[0][3]
        self.assertEqual(send["options"]["inputs"], [{"txid": "bb" * 32, "vout": 0}])
        self.assertTrue(send["options"]["add_inputs"])
        self.assertEqual(send["outputs"], [{LEARNER: "0.00100000"}])
        self.assertEqual(result["pot_coin"]["txid"], "bb" * 32)
        self.assertEqual(bots.store.passed_on(), 1)

    def test_locked_pot_coins_count_too(self):
        bots, node, _ = make()
        node.on("faucet", "listlockunspent", lambda: [{"txid": "cc" * 32, "vout": 1}])
        node.on(None, "gettxout", lambda t, v, mem: {
            "confirmations": 20, "value": Decimal("0.0005"), "scriptPubKey": {"address": POT_ADDR},
        })
        self.assertEqual(bots.pot_coins()[0]["txid"], "cc" * 32)

    def test_without_pot_coins_the_wallet_chooses(self):
        bots, node, _ = make()
        result = bots.pay(LEARNER)
        self.assertNotIn("inputs", node.calls("send")[0][3]["options"])
        self.assertIsNone(result["pot_coin"])

    def test_one_payment_per_address_per_day(self):
        bots, node, clock = make()
        bots.pay(LEARNER)
        with self.assertRaises(FaucetError) as e:
            bots.pay(LEARNER)
        self.assertEqual(e.exception.status, 429)
        clock["now"] += 25 * 3600
        bots.pay(LEARNER)
        self.assertEqual(len(node.calls("send")), 2)

    def test_global_rate_limit(self):
        bots, _, _ = make(per_minute=2)
        bots.pay("bcrt1qaaa")
        bots.pay("bcrt1qbbb")
        with self.assertRaises(FaucetError) as e:
            bots.pay("bcrt1qccc")
        self.assertEqual(e.exception.status, 429)

    def test_refuses_other_networks_and_own_addresses(self):
        bots, node, _ = make()
        for bad in ("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "", "x" * 200):
            with self.assertRaises(FaucetError) as e:
                bots.pay(bad)
            self.assertEqual(e.exception.status, 400)
        with self.assertRaises(FaucetError):
            bots.pay(POT_ADDR)
        self.assertEqual(node.calls("send"), [])

    def test_insufficient_funds_relocks_the_pot_coin(self):
        bots, node, _ = make()
        node.on("faucet", "listunspent", lambda *a: [pot_coin("aa" * 32, 3)])

        def broke(**kw):
            raise RPCError(-6, "Insufficient funds")

        node.on("faucet", "send", broke)
        with self.assertRaises(FaucetError) as e:
            bots.pay(LEARNER)
        self.assertEqual(e.exception.status, 503)
        relock = [c for c in node.calls("lockunspent") if c[2][0] is False]
        self.assertEqual(relock[-1][2][1], [{"txid": "aa" * 32, "vout": 0}])
        self.assertEqual(bots.store.total(), 0)


class UpkeepTests(unittest.TestCase):
    def test_consolidates_small_treasury_coins_in_capped_batches(self):
        bots, node, _ = make(consolidate_batch=100)
        coins = [{"txid": f"{i:064x}", "vout": 0, "amount": Decimal(to_btc(150 + i))} for i in range(300)]
        coins += [{"txid": "ee" * 32, "vout": 0, "amount": Decimal("50")}, {"txid": "dd" * 32, "vout": 0, "amount": Decimal("0.00000050")}]
        node.on("treasury", "listunspent", lambda *a: coins)
        node.on("treasury", "getnewaddress", lambda *a: "bcrt1qtreasury")
        node.on("treasury", "sendall", lambda **kw: {"txid": "c0" * 32})
        node.on(None, "getmempoolentry", lambda t: {"vsize": 1})
        self.assertEqual(bots._consolidate_batch(), "c0" * 32)
        inputs = node.calls("sendall")[0][3]["options"]["inputs"]
        self.assertEqual(len(inputs), 100)
        self.assertNotIn({"txid": "ee" * 32, "vout": 0}, inputs)  # too big to need it
        self.assertNotIn({"txid": "dd" * 32, "vout": 0}, inputs)  # costs more to spend than it holds
        self.assertIsNone(bots._consolidate_batch())  # waits while the last one is unconfirmed

    def test_no_consolidation_for_a_tidy_treasury(self):
        bots, node, _ = make()
        node.on("treasury", "listunspent", lambda *a: [{"txid": "ee" * 32, "vout": 0, "amount": Decimal("50")}])
        self.assertIsNone(bots._consolidate_batch())

    def test_refills_a_low_faucet_once(self):
        bots, node, _ = make()
        pending = {"sats": 0}
        node.on("faucet", "getbalances", lambda: {"mine": {"untrusted_pending": Decimal(to_btc(pending["sats"]))}})
        node.on("faucet", "getnewaddress", lambda *a: f"bcrt1qrefill{len(node.calls('getnewaddress'))}")
        node.on("treasury", "sendmany", lambda **kw: "aa" * 32)
        self.assertEqual(bots._refill_if_low(), "aa" * 32)
        self.assertEqual(len(node.calls("sendmany")[0][3]["amounts"]), 20)
        pending["sats"] = 1_000_000_000
        self.assertIsNone(bots._refill_if_low())


class AlertTests(unittest.TestCase):
    def test_alerts_once_and_recovers_once(self):
        sent = []
        alerter = Alerter("topic", send=lambda *a: sent.append(a), log=lambda m: None)
        alerter.update({"blocks": "No new block for 5 min", "disk": None})
        alerter.update({"blocks": "No new block for 6 min", "disk": None})
        self.assertEqual(len(sent), 1)
        alerter.update({"blocks": None, "disk": None})
        self.assertEqual(len(sent), 2)
        self.assertIn("recovered", sent[1][1])

    def test_problems(self):
        bots, _, _ = make()
        ok = {"height": 105, "block_age_seconds": 30, "esplora_height": 105, "faucet_sats": 10**9, "disk_used_pct": 10}
        self.assertTrue(all(v is None for v in bots.problems(ok).values()))
        bad = dict(ok, block_age_seconds=600, esplora_height=None, faucet_sats=5, disk_used_pct=90)
        self.assertTrue(all(bots.problems(bad).values()))

    def test_a_refill_on_its_way_is_not_an_empty_faucet(self):
        bots, _, _ = make()
        h = {"height": 105, "block_age_seconds": 30, "esplora_height": 105, "faucet_sats": 0,
             "faucet_pending_sats": 1_000_000_000, "disk_used_pct": 10}
        self.assertIsNone(bots.problems(h)["faucet"])


if __name__ == "__main__":
    unittest.main()
