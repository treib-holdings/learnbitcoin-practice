#!/usr/bin/env python3
"""Cross-check the practice wallet library against Bitcoin Core on regtest.

Runs on a box host (python3 there, Core in a throwaway container with
--network none, started by run.sh). Three phases, each run once:

  derive  descriptor checksums and derived addresses: ours vs Core's
  fund    Core funds two of our addresses; a watch-only Core wallet imports
          our descriptors and must see the same coins
  spend   our library's signed transaction must pass testmempoolaccept, be
          mined, pay the recipient and leave our change where we said

Every RPC call happens exactly once (a print-then-capture pattern would
broadcast twice). Results accumulate in results.json.
"""
import json
import pathlib
import subprocess
import sys

NAME = "lbp-xcheck"
DIR = pathlib.Path("/tmp") / NAME
RESULTS = DIR / "results.json"


def cli(*args, wallet=None, named=False):
    cmd = ["docker", "exec", NAME, "bitcoin-cli", "-regtest", f"-datadir={DIR}"]
    if wallet:
        cmd.append(f"-rpcwallet={wallet}")
    if named:
        cmd.append("-named")
    cmd += [str(a) for a in args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"bitcoin-cli {' '.join(cmd[6:])} failed: {proc.stderr.strip()}")
    out = proc.stdout.strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out


def sats(btc):
    return round(float(btc) * 100_000_000)


def load(name):
    return json.loads((DIR / name).read_text())


def save_results(update):
    results = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    results.update(update)
    RESULTS.write_text(json.dumps(results, indent=2))


def derive():
    plan = load("plan.json")
    checks = []
    for d in plan["descriptors"]:
        body, ours = d["desc"].split("#")
        info = cli("getdescriptorinfo", body)
        core_addrs = cli("deriveaddresses", d["desc"], json.dumps([0, len(d["expected"]) - 1]))
        checks.append({
            "desc": d["desc"],
            "our_checksum": ours,
            "core_checksum": info["checksum"],
            "addresses_match": core_addrs == d["expected"],
            "core_addresses": core_addrs,
            "ok": info["checksum"] == ours and core_addrs == d["expected"],
        })
    save_results({"core_version": cli("getnetworkinfo")["subversion"], "derive": checks})
    print("derive:", "OK" if all(c["ok"] for c in checks) else "MISMATCH")


def fund():
    plan = load("plan.json")
    cli("createwallet", "funder")
    mine_to = cli("getnewaddress", wallet="funder")
    cli("generatetoaddress", 101, mine_to)
    funding = [cli("sendtoaddress", addr, amount, wallet="funder") for addr, amount in plan["fund"]]
    cli("generatetoaddress", 1, mine_to)
    scan = cli("scantxoutset", "start", json.dumps([f"addr({addr})" for addr, _ in plan["fund"]]))
    recipient = cli("getnewaddress", wallet="funder")

    cli("createwallet", "wallet_name=watch", "disable_private_keys=true", "blank=true", named=True)
    imported = cli("importdescriptors", json.dumps([
        {"desc": plan["receive_descriptor"], "timestamp": 0, "active": True, "internal": False},
        {"desc": plan["change_descriptor"], "timestamp": 0, "active": True, "internal": True},
    ]), wallet="watch")
    watch = cli("getbalances", wallet="watch")["mine"]
    expected = sum(sats(a) for _, a in plan["fund"])

    (DIR / "utxos.json").write_text(json.dumps({
        "unspents": scan["unspents"],
        "recipient": recipient,
        "mine_to": mine_to,
    }, indent=2))
    ok = (
        all(i.get("success") for i in imported)
        and sats(watch["trusted"]) == expected
        and len(scan["unspents"]) == len(plan["fund"])
    )
    save_results({"fund": {
        "funding_txids": funding,
        "import_success": [i.get("success") for i in imported],
        "watch_only_trusted_sats": sats(watch["trusted"]),
        "expected_sats": expected,
        "ok": ok,
    }})
    print("fund:", "OK" if ok else "MISMATCH")


def spend():
    built = load("built.json")
    utxos = load("utxos.json")
    raw = (DIR / "tx.hex").read_text().strip()
    accept = cli("testmempoolaccept", json.dumps([raw]))[0]
    txid = cli("sendrawtransaction", raw)
    cli("generatetoaddress", 1, utxos["mine_to"])
    received = cli("getreceivedbyaddress", utxos["recipient"], 1, wallet="funder")
    change_scan = cli("scantxoutset", "start", json.dumps([f"addr({built['change_address']})"]))
    watch = cli("getbalances", wallet="watch")["mine"]
    decoded = cli("getrawtransaction", txid, 1)

    checks = {
        "allowed": accept.get("allowed"),
        "reject_reason": accept.get("reject-reason"),
        "txid_matches": txid == built["txid"],
        "core_vsize": accept.get("vsize"),
        "our_vsize": built["vsize"],
        "core_fee_sats": sats(accept["fees"]["base"]) if accept.get("allowed") else None,
        "our_fee_sats": built["fee"],
        "recipient_received_sats": sats(received),
        "expected_payment_sats": built["amount"],
        "change_found_sats": sats(change_scan["total_amount"]),
        "expected_change_sats": built["change"],
        "watch_only_after_sats": sats(watch["trusted"]),
        "rbf_signalled": all(vin["sequence"] == 0xFFFFFFFD for vin in decoded["vin"]),
        "confirmations": decoded.get("confirmations"),
    }
    checks["ok"] = bool(
        checks["allowed"]
        and checks["txid_matches"]
        and checks["core_vsize"] == checks["our_vsize"]
        and checks["core_fee_sats"] == checks["our_fee_sats"]
        and checks["recipient_received_sats"] == checks["expected_payment_sats"]
        and checks["change_found_sats"] == checks["expected_change_sats"]
        and checks["watch_only_after_sats"] == checks["expected_change_sats"]
        and checks["rbf_signalled"]
        and checks["confirmations"] == 1
    )
    save_results({"spend": checks})
    print("spend:", "OK" if checks["ok"] else "MISMATCH")


if __name__ == "__main__":
    {"derive": derive, "fund": fund, "spend": spend}[sys.argv[1]]()
