"""The bots' HTTP API, reached only through the router's Access-protected origin.

  GET  /health        node, electrs and faucet status (no auth)
  GET  /pot/stats     the pay-it-forward counter (no auth)
  GET  /pot/address   a fresh pot address (bearer token)
  POST /faucet        {"address": "bcrt1..."} -> one faucet payment (bearer token)

The practice app's Worker holds the token and checks Turnstile before it
calls /faucet.
"""

import hmac
import json
from http.server import BaseHTTPRequestHandler

from .bots import FaucetError
from .rpc import RPCError

MAX_BODY = 1024


def make_handler(bots, api_token: str, log=print):
    expected = f"Bearer {api_token}"

    class Handler(BaseHTTPRequestHandler):
        server_version = "practice-bots"
        sys_version = ""

        def log_message(self, fmt, *args):  # one short line per request, no client details
            log(f"{self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}")

        def _send_json(self, status: int, obj) -> None:
            body = json.dumps(obj, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self) -> bool:
            return hmac.compare_digest(self.headers.get("Authorization", ""), expected)

        def _guard(self, fn):
            try:
                self._send_json(200, fn())
            except FaucetError as e:
                self._send_json(e.status, {"error": e.message})
            except RPCError as e:
                log(f"rpc error: {e}")
                self._send_json(502, {"error": "The practice network could not do that just now"})
            except Exception as e:
                log(f"error: {e!r}")
                self._send_json(500, {"error": "Something went wrong"})

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/health":
                return self._guard(bots.health)
            if path == "/pot/stats":
                return self._guard(bots.pot_stats)
            if path == "/pot/address":
                if not self._authorized():
                    return self._send_json(401, {"error": "unauthorized"})
                return self._guard(bots.pot_address)
            self._send_json(404, {"error": "not found"})

        def do_POST(self):
            if self.path.split("?")[0] != "/faucet":
                return self._send_json(404, {"error": "not found"})
            if not self._authorized():
                return self._send_json(401, {"error": "unauthorized"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send_json(400, {"error": "Send a small JSON body with an address"})
            try:
                address = str(json.loads(self.rfile.read(length)).get("address", "")).strip()
            except (ValueError, AttributeError):
                return self._send_json(400, {"error": "Send JSON like {\"address\": \"bcrt1...\"}"})
            self._guard(lambda: bots.pay(address))

    return Handler
