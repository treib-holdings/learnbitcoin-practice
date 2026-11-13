#!/usr/bin/env python3
"""Two checks on the practice node. Run on the server, with the stack up:

  python3 tools/s1-checks/weight_and_reorg.py

1. Block weight cap. bitcoin.conf sets blockmaxweight=400000 so that a few
   transactions can form a queue for the fee lessons. Two transactions of
   about 310,000 weight units wait in the mempool; a block mined with
   generatetoaddress (what the producer uses) must hold only one of them.
2. Reorg. Invalidate the tip, mine a longer branch, and check that electrs
   (Esplora) and the explorer API report the new chain, including the new
   block hash at the old height.

The producer is paused during the checks and restarted at the end. The 5,000
small outputs go to a wallet called s1test, where they stay usable for later
lessons (consolidation, dust).
"""
import json
import subprocess
import time
import urllib.request

OPS = "/opt/learnbitcoin-practice/ops"


def cli(*args, stdin=None):
    p = subprocess.run([f"{OPS}/cli.sh", *map(str, args)], input=stdin, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"bitcoin-cli {' '.join(map(str, args[:2]))} failed: {p.stderr.strip()}")
    out = p.stdout.strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return out


def compose(*args):
    subprocess.run(["docker", "compose", "-f", f"{OPS}/compose.yaml", *args], check=True, capture_output=True)


def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.read().decode().strip()


def router_ip():
    fmt = "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"
    return subprocess.run(["docker", "inspect", "-f", fmt, "router"], capture_output=True, text=True, check=True).stdout.strip()


def weight_check(mine_to):
    if "s1test" not in cli("listwallets"):
        try:
            cli("loadwallet", "s1test")
        except RuntimeError:
            cli("-named", "createwallet", "wallet_name=s1test")
    desc = next(
        d["desc"] for d in cli("-rpcwallet=s1test", "listdescriptors")["descriptors"]
        if d["desc"].startswith("wpkh(") and not d.get("internal")
    )
    addresses = cli("deriveaddresses", desc, json.dumps([0, 4999]))
    txids = []
    for chunk in (addresses[:2500], addresses[2500:]):
        amounts = json.dumps({a: 0.0001 for a in chunk})
        txids.append(cli("-rpcwallet=treasury", "-stdin", "sendmany", stdin=f'""\n{amounts}\n'))
    before = cli("getmempoolinfo")
    tx_weights = [cli("getmempoolentry", t)["weight"] for t in txids]
    b1 = cli("getblock", cli("generatetoaddress", 1, mine_to)[0], 1)
    left = cli("getmempoolinfo")["size"]
    b2 = cli("getblock", cli("generatetoaddress", 1, mine_to)[0], 1)
    return {
        "tx_weights": tx_weights,
        "mempool_before": {"txs": before["size"], "vbytes": before["bytes"]},
        "block1": {"weight": b1["weight"], "txs": b1["nTx"]},
        "mempool_left_after_block1": left,
        "block2": {"weight": b2["weight"], "txs": b2["nTx"]},
        "cap_honoured": b1["weight"] <= 400_000 and left >= 1,
    }


def reorg_check(mine_to):
    r = router_ip()
    height = cli("getblockcount")
    old_hash = cli("getblockhash", height)
    time.sleep(3)
    esplora_saw_old = get(f"http://{r}:8081/esplora/block-height/{height}") == old_hash
    cli("invalidateblock", old_hash)
    cli("generatetoaddress", 2, mine_to)
    node_tip = cli("getblockcount")
    best = cli("getbestblockhash")
    new_at_height = cli("getblockhash", height)
    deadline = time.time() + 60
    while True:
        esplora_tip = int(get(f"http://{r}:8081/esplora/blocks/tip/height"))
        esplora_at_height = get(f"http://{r}:8081/esplora/block-height/{height}")
        explorer_tip = get(f"http://{r}:8082/api/blocks/tip/hash")
        done = esplora_tip == node_tip and esplora_at_height == new_at_height and explorer_tip == best
        if done or time.time() > deadline:
            break
        time.sleep(2)
    return {
        "height": height,
        "invalidated": old_hash,
        "esplora_saw_old_block_first": esplora_saw_old,
        "node_tip": node_tip,
        "esplora_tip": esplora_tip,
        "esplora_hash_at_height_is_new": esplora_at_height == new_at_height,
        "explorer_tip_matches_node": explorer_tip == best,
        "followed": done,
    }


def main():
    compose("stop", "producer")
    results = {}
    try:
        mine_to = cli("-rpcwallet=treasury", "getnewaddress", "s1-check", "bech32")
        results["weight"] = weight_check(mine_to)
        results["reorg"] = reorg_check(mine_to)
    finally:
        compose("start", "producer")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
