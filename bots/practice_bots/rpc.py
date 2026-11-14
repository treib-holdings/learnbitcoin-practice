"""A small Bitcoin Core JSON-RPC client. Amounts come back as Decimal, never float."""

import base64
import itertools
import json
import urllib.error
import urllib.request
from decimal import Decimal

COIN = 100_000_000


def to_sats(btc) -> int:
    return int((Decimal(btc) * COIN).to_integral_value())


def to_btc(sats: int) -> str:
    """Satoshis as an exact BTC string, which Core accepts for amounts."""
    return f"{sats // COIN}.{sats % COIN:08d}"


class RPCError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(f"RPC error {code}: {message}")
        self.code = code
        self.message = message


class RPC:
    def __init__(self, url: str, user: str, password: str, wallet: str | None = None, timeout: int = 60):
        self.url = url.rstrip("/")
        self.user = user
        self.password = password
        self.wallet = wallet
        self.timeout = timeout
        self._auth = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
        self._ids = itertools.count()

    def with_wallet(self, name: str) -> "RPC":
        return RPC(self.url, self.user, self.password, wallet=name, timeout=self.timeout)

    def call(self, method: str, *params, **named):
        if params and named:
            raise ValueError("use positional or named parameters, not both")
        body = json.dumps({
            "jsonrpc": "1.0",
            "id": next(self._ids),
            "method": method,
            "params": named if named else list(params),
        }).encode()
        url = self.url + (f"/wallet/{self.wallet}" if self.wallet else "")
        request = urllib.request.Request(
            url, data=body, headers={"Authorization": self._auth, "Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read(), parse_float=Decimal)
        except urllib.error.HTTPError as e:  # Core answers RPC errors with HTTP 500 and a JSON body
            raw = e.read()
            if not raw:
                raise RPCError(e.code, e.reason) from None
            payload = json.loads(raw, parse_float=Decimal)
        if payload.get("error"):
            raise RPCError(payload["error"]["code"], payload["error"]["message"])
        return payload["result"]
