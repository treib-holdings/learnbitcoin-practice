"""Unit tests for the bots' decisions, against a fake node. Run: python3 -m unittest discover -s bots/tests"""

import os
import sys
import tempfile
import threading
import time
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

    def before(self, fn):
        """fn(method) runs just before the node answers each call: the place for
        something that happens at the node between two of the bots' calls."""
        self.shared["before"] = fn

    def call(self, method, *params, **named):
        self.shared["calls"].append((self.wallet, method, params, named))
        if self.shared.get("before"):
            self.shared["before"](method)
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


class Pot:
    """The pot as a node shows it: a newest block, the payments to the pot that are
    in a block, and the pot coins that wait, locked as upkeep leaves them. Every
    pot coin is 30,000 sats. The first payment made two of them, so the number of
    payments and the number of coins differ."""

    def __init__(self, node, payments):
        self.height = 500
        self.payments = []  # the txids of the payments to the pot that are in a block
        self.coins = {}  # every pot coin that no block has spent: (txid, vout) -> the height of its own block
        self.locked = set()
        self.spent = set()  # spent by a faucet payment that is not in a block yet
        self.sats = 0  # all that the pot ever got
        self.sends = 0
        for _ in range(payments):
            self._pay_the_pot()
        node.on(None, "getbestblockhash", lambda: f"{self.height:064x}")
        node.on("faucet", "listreceivedbyaddress", self.received)
        node.on("faucet", "listunspent", self.unspent)
        node.on("faucet", "listlockunspent", lambda: [{"txid": t, "vout": v} for t, v in sorted(self.locked)])
        node.on(None, "gettxout", self.txout)
        node.on("faucet", "lockunspent", self.lock)
        node.on("faucet", "send", self.send)

    def _pay_the_pot(self):
        txid = f"{0xA0000 + len(self.payments):064x}"
        for vout in (0,) if self.payments else (0, 1):
            self.coins[(txid, vout)] = self.height
            self.locked.add((txid, vout))
            self.sats += 30_000
        self.payments.append(txid)

    def block(self, payments=0):
        """A new block: it holds what the faucet paid since the last one, and `payments` new payments to the pot."""
        self.height += 1
        for coin in self.spent:
            del self.coins[coin]
            self.locked.discard(coin)
        self.spent.clear()
        for _ in range(payments):
            self._pay_the_pot()

    def received(self, minconf, include_empty, include_watchonly):
        return [
            {"address": "bcrt1qrefill", "label": "refill", "amount": Decimal("0.5"), "txids": ["ee" * 32]},
            {"address": POT_ADDR, "label": "pot", "amount": Decimal(to_btc(self.sats)), "txids": list(self.payments)},
        ]

    def unspent(self, minconf=1, maxconf=9999999, addresses=None):
        return [
            pot_coin(txid, self.height - height + 1, vout=vout)
            for (txid, vout), height in self.coins.items()
            if (txid, vout) not in self.locked and (txid, vout) not in self.spent
        ]

    def txout(self, txid, vout, include_mempool):
        # Asked without the mempool, a node still shows a coin that a payment not yet in a block has spent.
        if (txid, vout) not in self.coins:
            return None
        return {
            "confirmations": self.height - self.coins[(txid, vout)] + 1,
            "value": Decimal(to_btc(30_000)),
            "scriptPubKey": {"address": POT_ADDR},
        }

    def lock(self, unlock, coins=(), persistent=False):
        for coin in coins:
            (self.locked.discard if unlock else self.locked.add)((coin["txid"], coin["vout"]))
        return True

    def send(self, **named):
        self.spent.update((coin["txid"], coin["vout"]) for coin in named["options"].get("inputs", []))
        self.sends += 1
        return {"complete": True, "txid": f"{0xF0000 + self.sends:064x}"}


def pot_world(payments):
    bots, node, _ = make()
    return bots, node, Pot(node, payments)


def reading(coins):
    """What one reading of the pot's counts asks the node, with `coins` pot coins locked."""
    return {
        "getbestblockhash": 1, "listreceivedbyaddress": 1, "getaddressesbylabel": 1, "listunspent": 1,
        "listlockunspent": 1, "gettxout": coins,
    }


KEPT = {"getbestblockhash": 1}  # what a look asks the node while the counts are kept


def asked(node):
    """How often the bots called each method of the node since this was last asked."""
    seen = {}
    for _wallet, method, _params, _named in node.shared["calls"]:
        seen[method] = seen.get(method, 0) + 1
    node.shared["calls"].clear()
    return seen


def calls_of_a_reading(payments):
    bots, node, _ = pot_world(payments)
    bots.pot_stats()
    return len(node.shared["calls"])


def nth(n, happen):
    """For FakeNode.before: happen() runs once, just before the node answers the n-th call from now."""
    left = {"n": n}

    def before(_method):
        left["n"] -= 1
        if left["n"] == 0:
            happen()

    return before


def on_a_thread(fn, *args):
    """Run fn(*args) on a thread of its own. Gives the thread, and a box that gets its answer or its error."""
    box = {}

    def run():
        try:
            box["answer"] = fn(*args)
        except Exception as e:
            box["error"] = e

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread, box


class PotAddressTests(unittest.TestCase):
    def test_the_same_address_until_it_is_paid(self):
        bots, node, _ = make()
        made = []
        received = {}

        def new_address(*a):
            made.append(f"bcrt1qpot{len(made)}")
            return made[-1]

        node.on("faucet", "listreceivedbyaddress", lambda *a: [])
        node.on("faucet", "getnewaddress", new_address)
        node.on("faucet", "getreceivedbyaddress", lambda a, minconf: received.get(a, Decimal(0)))

        first = bots.pot_address()["address"]
        for _ in range(50):
            self.assertEqual(bots.pot_address()["address"], first)
        self.assertEqual(made, [first], "asking again must not make new addresses")
        self.assertEqual(node.calls("getnewaddress")[0][2], ("pot", "bech32"))
        self.assertEqual(node.calls("getreceivedbyaddress")[0][2], (first, 0), "an unconfirmed payment counts")

        received[first] = Decimal("0.00050000")
        second = bots.pot_address()["address"]
        self.assertNotEqual(second, first)
        self.assertEqual(bots.pot_address()["address"], second)
        self.assertEqual(len(made), 2)

    def test_after_a_restart_an_unpaid_pot_address_is_reused(self):
        bots, node, _ = make()
        node.on("faucet", "listreceivedbyaddress", lambda *a: [
            {"address": "bcrt1qrefill", "label": "refill", "amount": Decimal(0), "txids": []},
            {"address": "bcrt1qpaid", "label": "pot", "amount": Decimal("0.001"), "txids": ["aa" * 32]},
            {"address": "bcrt1qunpaid", "label": "pot", "amount": Decimal(0), "txids": []},
        ])
        node.on("faucet", "getreceivedbyaddress", lambda a, minconf: Decimal(0))
        self.assertEqual(bots.pot_address()["address"], "bcrt1qunpaid")
        self.assertEqual(node.calls("listreceivedbyaddress")[0][2], (0, True, False))
        self.assertEqual(bots.pot_address()["address"], "bcrt1qunpaid")
        self.assertEqual(len(node.calls("listreceivedbyaddress")), 1, "looked up once, then remembered")
        self.assertEqual(node.calls("getnewaddress"), [])

    def test_after_a_restart_with_every_pot_address_paid_a_new_one_is_made(self):
        bots, node, _ = make()
        node.on("faucet", "listreceivedbyaddress", lambda *a: [
            {"address": "bcrt1qpaid", "label": "pot", "amount": Decimal("0.001"), "txids": ["aa" * 32]},
        ])
        node.on("faucet", "getnewaddress", lambda *a: "bcrt1qfresh")
        self.assertEqual(bots.pot_address()["address"], "bcrt1qfresh")


class PotStatsTests(unittest.TestCase):
    """The pot's counter. Its counts are read from the node once and kept, and read
    again only after a new block or a faucet payment, whoever asks and however often."""

    def test_many_looks_at_one_block_are_one_reading(self):
        bots, node, _ = pot_world(payments=7)
        answers = [bots.pot_stats() for _ in range(100)]
        self.assertEqual(node.calls("listreceivedbyaddress")[0][2], (1, False, False), "only what is in a block counts")
        self.assertEqual(asked(node), {**reading(coins=8), "getbestblockhash": 100})
        self.assertEqual(list(answers[0].items()), [
            ("learners_passed_on", 7), ("sats_received", 240_000), ("coins_waiting", 8),
            ("coins_passed_to_newcomers", 0), ("faucet_payments", 0),
        ])
        self.assertTrue(all(answer == answers[0] for answer in answers))
        answers[0]["coins_waiting"] = -1  # an answer is the caller's own: writing in it changes nothing that is kept
        self.assertEqual(bots.pot_stats(), answers[1])

    def test_a_new_block_is_one_more_reading(self):
        bots, node, pot = pot_world(payments=7)
        bots.pot_stats()
        asked(node)
        pot.block(payments=1)
        after = bots.pot_stats()
        self.assertEqual(asked(node), reading(coins=9))
        self.assertEqual(
            (after["learners_passed_on"], after["sats_received"], after["coins_waiting"]), (8, 270_000, 9),
            "the first look after a block shows what the block confirmed",
        )
        for _ in range(20):
            self.assertEqual(bots.pot_stats(), after)
        self.assertEqual(asked(node), {"getbestblockhash": 20})
        pot.block()  # nothing in it for the pot, which nobody can know without a reading
        self.assertEqual(bots.pot_stats(), after)
        self.assertEqual(asked(node), reading(coins=9))

    def test_a_faucet_payment_is_one_more_reading(self):
        bots, node, _ = pot_world(payments=7)
        before = bots.pot_stats()
        bots.pay(LEARNER)
        asked(node)
        after = bots.pot_stats()
        self.assertEqual(asked(node), reading(coins=7))
        self.assertEqual(after, {**before, "coins_waiting": 7, "coins_passed_to_newcomers": 1, "faucet_payments": 1})
        for _ in range(20):
            self.assertEqual(bots.pot_stats(), after)
        self.assertEqual(asked(node), {"getbestblockhash": 20})
        with self.assertRaises(FaucetError):  # one payment per address per day: nothing is paid
            bots.pay(LEARNER)
        asked(node)
        self.assertEqual(bots.pot_stats(), after)
        self.assertEqual(asked(node), KEPT, "a payment that was refused changed nothing, so it costs no reading")

    def test_many_callers_at_once_share_one_reading(self):
        bots, node, pot = pot_world(payments=7)
        bots.pot_stats()
        pot.block(payments=1)  # the callers find counts that are kept, but not for this block
        asked(node)
        inside = {"now": 0, "most": 0}
        count = threading.Lock()
        crowd = threading.Event()

        def slow(*params):
            with count:
                inside["now"] += 1
                inside["most"] = max(inside["most"], inside["now"])
                if inside["now"] > 1:
                    crowd.set()
            crowd.wait(0.2)  # time for the other callers to get this far too, if anything lets them
            with count:
                inside["now"] -= 1
            return pot.received(*params)

        node.on("faucet", "listreceivedbyaddress", slow)
        together = threading.Barrier(30)

        def look():
            together.wait(10)
            return bots.pot_stats()

        callers = [on_a_thread(look) for _ in range(30)]
        for thread, _ in callers:
            thread.join(10)
        self.assertEqual(inside["most"], 1, "two readings were under way at the same moment")
        self.assertEqual(asked(node), {**reading(coins=9), "getbestblockhash": 30})
        new = {
            "learners_passed_on": 8, "sats_received": 270_000, "coins_waiting": 9,
            "coins_passed_to_newcomers": 0, "faucet_payments": 0,
        }
        self.assertEqual(
            [box.get("answer") for _, box in callers], [new] * 30,
            "every caller gets the new block's counts, none the counts of the block before",
        )

    def test_all_the_looks_together_ask_the_node_one_thing_at_a_time(self):
        bots, node, pot = pot_world(payments=7)
        bots.pot_stats()
        pot.block()  # one of the looks below is a reading
        at_once = {"now": 0, "most": 0}
        count = threading.Lock()

        def the_node_is_busy(_method):
            with count:
                at_once["now"] += 1
                at_once["most"] = max(at_once["most"], at_once["now"])
            time.sleep(0.002)
            with count:
                at_once["now"] -= 1

        node.before(the_node_is_busy)
        callers = [on_a_thread(bots.pot_stats) for _ in range(20)]
        for thread, _ in callers:
            thread.join(10)
        self.assertEqual([box.get("answer") for _, box in callers], [bots.pot_stats()] * 20)
        self.assertEqual(at_once["most"], 1, "two looks had a call at the node at the same moment")

    def test_a_reading_that_fails_is_not_kept(self):
        bots, node, pot = pot_world(payments=7)
        left = {"n": 3}

        def gives_up(*params):
            left["n"] -= 1
            if left["n"] == 0:
                raise RPCError(-28, "Loading wallet...")
            return pot.txout(*params)

        node.on(None, "gettxout", gives_up)
        with self.assertRaises(RPCError):  # the first look after a start, and the node gives up half-way
            bots.pot_stats()
        self.assertEqual(asked(node), reading(coins=3))
        first = bots.pot_stats()
        self.assertEqual(asked(node), reading(coins=8), "the next caller reads it all again")
        self.assertEqual((first["learners_passed_on"], first["sats_received"], first["coins_waiting"]), (7, 240_000, 8))
        self.assertEqual(bots.pot_stats(), first)
        self.assertEqual(asked(node), KEPT)

        # The same with counts kept from the block before. Neither the failure nor half a
        # reading takes their place, and they are not given out for a block they were not read at.
        pot.block(payments=1)
        left["n"] = 5
        with self.assertRaises(RPCError):
            bots.pot_stats()
        self.assertEqual(asked(node), reading(coins=5))
        second = bots.pot_stats()
        self.assertEqual(asked(node), reading(coins=9))
        self.assertEqual(second, {**first, "learners_passed_on": 8, "sats_received": 270_000, "coins_waiting": 9})
        self.assertEqual(bots.pot_stats(), second)
        self.assertEqual(asked(node), KEPT)

        # And when the node does not answer at all, which is no RPC error.
        newest = node.shared["handlers"][(None, "getbestblockhash")]

        def silent():
            raise TimeoutError("timed out")

        node.on(None, "getbestblockhash", silent)
        with self.assertRaises(TimeoutError):
            bots.pot_stats()
        node.on(None, "getbestblockhash", newest)
        self.assertEqual(bots.pot_stats(), second)

    def test_callers_who_waited_for_a_reading_that_failed_read_again(self):
        bots, node, pot = pot_world(payments=7)
        seen = {"n": 0}
        count = threading.Lock()
        crowd = threading.Event()

        def fails_the_first_time(*params):
            with count:
                seen["n"] += 1
                mine = seen["n"]
                if mine > 1:
                    crowd.set()
            if mine == 1:
                crowd.wait(0.2)  # the other callers arrive meanwhile
                raise RPCError(-28, "Loading wallet...")
            return pot.received(*params)

        node.on("faucet", "listreceivedbyaddress", fails_the_first_time)
        callers = [on_a_thread(bots.pot_stats) for _ in range(10)]
        for thread, _ in callers:
            thread.join(10)
        self.assertEqual(len([box for _, box in callers if isinstance(box.get("error"), RPCError)]), 1)
        answers = [box["answer"] for _, box in callers if "answer" in box]
        self.assertEqual(len(answers), 9, "the failure is the answer to one caller only")
        self.assertEqual(
            asked(node), {**reading(coins=8), "getbestblockhash": 10, "listreceivedbyaddress": 2},
            "one of those who waited reads again, and the others share that reading",
        )
        self.assertEqual(answers, [{**answers[0], "learners_passed_on": 7, "coins_waiting": 8}] * 9)

    def test_a_block_that_comes_during_a_reading_is_not_missed(self):
        last = calls_of_a_reading(payments=2)
        for k in range(1, last + 2):  # last + 1: the block comes when the reading is over
            with self.subTest(the_block_comes_before_call=k):
                bots, node, pot = pot_world(payments=2)
                node.before(nth(k, lambda: pot.block(payments=1)))
                bots.pot_stats()
                second = bots.pot_stats()
                self.assertEqual(
                    (second["learners_passed_on"], second["sats_received"], second["coins_waiting"]), (3, 120_000, 4),
                    "a look after the block shows what the block confirmed",
                )
                self.assertLessEqual(len(node.calls("listreceivedbyaddress")), 2)
                asked(node)
                self.assertEqual(bots.pot_stats(), second)
                self.assertEqual(asked(node), KEPT)

    def test_a_faucet_payment_that_lands_during_a_reading_is_not_missed(self):
        last = calls_of_a_reading(payments=2)
        stuck = []
        for k in range(1, last + 2):  # last + 1: the payment lands when the reading is over
            with self.subTest(the_payment_lands_before_call=k):
                bots, node, _ = pot_world(payments=2)

                def pay():
                    payer, paid = on_a_thread(bots.pay, LEARNER)
                    payer.join(10)
                    if "answer" not in paid:
                        stuck.append(k)
                    self.assertIn("answer", paid, "the faucet could not pay while a reading was under way")

                node.before(nth(k, pay))
                bots.pot_stats()
                second = bots.pot_stats()
                self.assertEqual(list(second.values()), [2, 90_000, 2, 1, 1], "a look after the payment shows it")
                self.assertLessEqual(len(node.calls("listreceivedbyaddress")), 2)
                asked(node)
                self.assertEqual(bots.pot_stats(), second)
                self.assertEqual(asked(node), KEPT)
            if stuck:
                break  # at every other moment it would wait as long and say the same

    def test_a_look_does_not_wait_for_a_faucet_payment(self):
        bots, node, pot = pot_world(payments=7)
        kept = bots.pot_stats()
        paying, go_on = threading.Event(), threading.Event()

        def slow_send(**named):
            paying.set()
            go_on.wait(10)
            return pot.send(**named)

        node.on("faucet", "send", slow_send)
        payer, paid = on_a_thread(bots.pay, LEARNER)
        self.assertTrue(paying.wait(10))  # the faucet holds its lock, and the node takes its time
        asked(node)
        try:
            looker, looked = on_a_thread(bots.pot_stats)
            looker.join(10)
            self.assertEqual(looked.get("answer"), kept, "the look waited for the faucet")
            self.assertEqual(asked(node), KEPT)
        finally:
            go_on.set()
            payer.join(10)
        self.assertIn("answer", paid)
        paid_on = {**kept, "coins_waiting": 7, "coins_passed_to_newcomers": 1, "faucet_payments": 1}
        self.assertEqual(bots.pot_stats(), paid_on)

    def test_a_faucet_payment_does_not_wait_for_a_look(self):
        bots, node, pot = pot_world(payments=7)
        reads, go_on = threading.Event(), threading.Event()

        def slow(*params):
            reads.set()
            go_on.wait(10)
            return pot.received(*params)

        node.on("faucet", "listreceivedbyaddress", slow)
        looker, looked = on_a_thread(bots.pot_stats)
        self.assertTrue(reads.wait(10))  # a reading is under way, and the node takes its time
        try:
            payer, paid = on_a_thread(bots.pay, LEARNER)
            payer.join(10)
            self.assertIn("answer", paid, "the faucet waited for a look")
        finally:
            go_on.set()
            looker.join(10)
        paid_on = {
            "learners_passed_on": 7, "sats_received": 240_000, "coins_waiting": 7,
            "coins_passed_to_newcomers": 1, "faucet_payments": 1,
        }
        self.assertEqual(looked.get("answer"), paid_on)
        self.assertEqual(bots.pot_stats(), paid_on)

    def test_a_look_that_waits_too_long_for_its_turn_gives_up(self):
        bots, node, pot = pot_world(payments=7)
        self.assertEqual(bots.stats_wait_seconds, 20, "longer than the Worker listens; the queue stays short")
        bots.stats_wait_seconds = 0.05
        reads, go_on = threading.Event(), threading.Event()

        def slow(*params):
            reads.set()
            go_on.wait(10)
            return pot.received(*params)

        node.on("faucet", "listreceivedbyaddress", slow)
        reader, read = on_a_thread(bots.pot_stats)
        self.assertTrue(reads.wait(10))  # a reading is under way, and the node takes its time
        asked(node)
        try:
            with self.assertRaises(FaucetError) as e:
                bots.pot_stats()
            self.assertEqual((e.exception.status, e.exception.code), (503, "unavailable"))
            self.assertEqual(asked(node), {}, "a look that gives up has asked the node nothing")
        finally:
            go_on.set()
            reader.join(10)
        self.assertIn("answer", read)
        asked(node)
        self.assertEqual(bots.pot_stats(), read["answer"], "the reading it waited for was kept all the same")
        self.assertEqual(asked(node), KEPT)

    def test_nothing_is_kept_from_before_a_start(self):
        bots, node, _ = pot_world(payments=7)
        first = bots.pot_stats()
        asked(node)
        again = Bots(bots.cfg, node, bots.store, clock=bots.clock, fetch=bots.fetch)  # the same node, block and records
        self.assertEqual(again.pot_stats(), first)
        self.assertEqual(asked(node), reading(coins=8))
        self.assertEqual(again.pot_stats(), first)
        self.assertEqual(asked(node), KEPT)


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
        self.assertEqual((e.exception.status, e.exception.code), (429, "already_paid"))
        clock["now"] += 25 * 3600
        bots.pay(LEARNER)
        self.assertEqual(len(node.calls("send")), 2)

    def test_global_rate_limit(self):
        bots, _, _ = make(per_minute=2)
        bots.pay("bcrt1qaaa")
        bots.pay("bcrt1qbbb")
        with self.assertRaises(FaucetError) as e:
            bots.pay("bcrt1qccc")
        self.assertEqual((e.exception.status, e.exception.code), (429, "busy"))

    def test_refuses_other_networks_and_own_addresses(self):
        bots, node, _ = make()
        for bad in ("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "", "x" * 200):
            with self.assertRaises(FaucetError) as e:
                bots.pay(bad)
            self.assertEqual((e.exception.status, e.exception.code), (400, "bad_address"))
        with self.assertRaises(FaucetError) as e:
            bots.pay(POT_ADDR)
        self.assertEqual(e.exception.code, "own_address")
        self.assertEqual(node.calls("send"), [])

    def test_insufficient_funds_relocks_the_pot_coin(self):
        bots, node, _ = make()
        node.on("faucet", "listunspent", lambda *a: [pot_coin("aa" * 32, 3)])

        def broke(**kw):
            raise RPCError(-6, "Insufficient funds")

        node.on("faucet", "send", broke)
        with self.assertRaises(FaucetError) as e:
            bots.pay(LEARNER)
        self.assertEqual((e.exception.status, e.exception.code), (503, "refilling"))
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
