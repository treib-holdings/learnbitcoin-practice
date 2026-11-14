"""The faucet's own records: one row per payment (SQLite, on the data volume).

Only practice-network addresses and transaction ids are kept. Nothing here
identifies a person.
"""

import sqlite3
import threading


class Store:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.execute(
                """CREATE TABLE IF NOT EXISTS payouts (
                       id INTEGER PRIMARY KEY,
                       address TEXT NOT NULL,
                       txid TEXT NOT NULL,
                       amount_sats INTEGER NOT NULL,
                       pot_txid TEXT,
                       pot_vout INTEGER,
                       created_at INTEGER NOT NULL)"""
            )
            self._db.execute("CREATE INDEX IF NOT EXISTS payouts_address ON payouts(address, created_at)")

    def record(self, address: str, txid: str, amount_sats: int, pot: dict | None, now: int) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO payouts (address, txid, amount_sats, pot_txid, pot_vout, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (address, txid, amount_sats, pot["txid"] if pot else None, pot["vout"] if pot else None, now),
            )

    def last_payout_to(self, address: str) -> int | None:
        with self._lock:
            row = self._db.execute("SELECT MAX(created_at) FROM payouts WHERE address = ?", (address,)).fetchone()
        return row[0]

    def payouts_since(self, since: int) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM payouts WHERE created_at >= ?", (since,)).fetchone()[0]

    def passed_on(self) -> int:
        """Faucet payments that carried a coin an earlier learner put in the pot."""
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM payouts WHERE pot_txid IS NOT NULL").fetchone()[0]

    def total(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM payouts").fetchone()[0]
