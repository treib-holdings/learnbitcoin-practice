# LearnBitcoin practice wallet

A real Bitcoin wallet on a practice network with no value, so readers of
[LearnBitcoin.com](https://www.learnbitcoin.com) can do each step the Journey
teaches before they risk real money.

**Status:** early build. Nothing is deployed and nothing here holds value.

## Ground rules

- **No real value.** Practice coins only, on a private regtest chain
  (addresses start `bcrt1`). The wallet cannot produce a mainnet address.
- **No accounts, no tracking.** Keys and progress stay in the reader's
  browser. Any measurement is aggregate and cookieless.
- **Real, not faked.** Real transactions on a real chain, built and signed
  in the browser, readable by standard software.
- **Portable.** Standard BIP39 words and BIP84 descriptors: the same 12 words
  restore the same practice wallet in Sparrow or Bitcoin Core.

## Layout

| Folder | What |
|---|---|
| `wallet/` | Keys (passkey PRF or random words), addresses, descriptors, chain scan, payments. Pure TypeScript on the audited @scure / @noble libraries; no WebAssembly. |
| `ops/` | The practice network: Bitcoin Core (regtest), electrs, mempool explorer, Cloudflare tunnel. |
| `tools/regtest-crosscheck/` | Checks the wallet library against Bitcoin Core on regtest. |
| `bots/` | Block producer, faucet and the other scripted counterparties (to come). |

## Keys

With a passkey, the WebAuthn PRF extension returns 32 secret bytes for a
fixed input; HKDF-SHA256 turns them into 16 bytes of BIP39 entropy, which
encode as 12 words. Without a passkey, the 12 words come from the browser's
random number generator. Either way the account is BIP84 at `m/84'/1'/0'`.
The exact parameters are in `wallet/src/keys.ts` and frozen by test vectors
in `wallet/test/vectors.json`.

## Tests

```sh
pnpm install
pnpm test     # node:test, runs TypeScript directly (Node 22.18+)
pnpm check    # tsc --noEmit
```

The test vectors are checked independently: the published BIP84 vectors,
HKDF against Python's standard library, and addresses, descriptor checksums
and a signed payment against Bitcoin Core 31.2 on regtest.

## License

MIT. See [LICENSE](LICENSE).
