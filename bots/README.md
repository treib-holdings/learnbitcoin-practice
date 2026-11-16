# bots: the practice network's scripted counterparties

One small Python service (standard library only). Every key lives in a
Bitcoin Core wallet on the practice node; the bots only ask Core to build and
sign.

| Part | What it does |
|---|---|
| Treasury | Holds every practice coin (mined at setup). Upkeep consolidates its small late-issuance coinbase coins, one batch per block at most. |
| Faucet | Pays a fixed amount (100,000 sats) to a learner's `bcrt1` address: one payment per address per day, a cap per minute. |
| Pay-it-forward pot | Learners send coins to fresh `pot` addresses. A faucet payment spends the **oldest** pot coin first, so a newcomer's first coin traces on the explorer to a real earlier learner's payment. Pot coins stay locked until then. |
| Refill | When the faucet's own coins drop below 2 BTC, the treasury sends 20 coins of 0.5 BTC, so faucet payments need one or two inputs. |
| Alerts | Every minute: block age, electrs lag, faucet balance, disk. A message to the operator's ntfy topic when something goes wrong, and one when it recovers. |

The 30-second block producer is a separate container (`ops/producer`), so a
bug here never stops the chain.

## API

Reached only through the router's origin port (`/bots/...`), behind
Cloudflare Access. The practice app's Worker holds the bearer token and
checks Turnstile before calling `/faucet`.

| Request | Auth | Answer |
|---|---|---|
| `GET /health` | none | height, block age, electrs height, faucet balance, disk use |
| `GET /pot/stats` | none | the pay-it-forward counter: learners who passed coins on, sats received, coins waiting, coins passed to newcomers, faucet payments |
| `GET /pot/address` | bearer | a fresh pot address |
| `POST /faucet` `{"address": "bcrt1..."}` | bearer | `{txid, amount_sats, pot_coin}` |

Every refusal is JSON `{"error": <sentence>, "code": <stable code>}`. The faucet's
codes: `bad_address`, `own_address` (400), `already_paid`, `busy` (429), `refilling`
(503), `failed` (500). The app shows its own text for each code, in the reader's
language; the sentence is for logs and for people calling the API by hand.

Anybody can ask for `/pot/stats` through the Worker. Reading the counter from
the node takes up to four calls and one more for every locked pot coin, and
anybody can add pot coins by paying the pot, so the bots do not read it for
every request. They read it once and keep it, and read it again only when the
newest block or the number of faucet payments has changed: payments to the pot
and pot coins confirm with a block, and a pot coin leaves with a faucet
payment. Every other request costs the node one call (`getbestblockhash`).

Requests that arrive while the counter is being read wait for that one reading
and share it. One that has waited 20 seconds for its turn gives up with
`unavailable` (503): the Worker has stopped listening by then, and requests
must not queue without end when a reading takes longer than the next block
takes to come. A reading that fails is not kept: the next request reads again.
The counter has a lock of its own, never the faucet's: a look at the counter
does not wait for a faucet payment to finish, and a payment does not wait for a
look.

## Tests

```sh
python3 -m unittest discover -s bots/tests
```
