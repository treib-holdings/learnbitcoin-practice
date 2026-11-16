# LearnBitcoin practice wallet

A working Bitcoin wallet in the browser, on a practice network whose coins
have no value. Readers of [LearnBitcoin.com](https://www.learnbitcoin.com) use
it to do each step the Journey teaches (make a wallet, write down its 12
words, receive, send, read a transaction, restore) before any real money is
at stake.

The code is public so that anyone can see what the wallet does with keys, and
because it doubles as teaching material: its comments say why, in plain
language.

**Status:** the practice network runs. The wallet app in this repository is
built and tested against a stand-in of that network. It is live at
practice.learnbitcoin.com, and not yet linked from the main site.
Six guided "Do it" steps (under `/do`) take a reader through what the site's
Journey teaches: hold some, pass it on, see that there are no balances, wait
for a block, write down the 12 words, prove the backup. Nothing here holds value.

## Ground rules

- **No real value.** Practice coins only, on a private regtest chain
  (addresses start `bcrt1`). The wallet cannot produce a mainnet address, and
  it refuses to pay one.
- **No accounts, no tracking.** There is no account to open and the app sets
  no cookies. The wallet's keys stay in the reader's browser. What is counted
  is a screen view or one of a short, closed list of events, with no ID.
- **Real, not faked.** Real transactions on a real chain, built and signed
  in the browser, readable by standard software.
- **Portable.** Standard BIP39 words and BIP84 descriptors: the same 12 words
  restore the same practice wallet in Sparrow (started in its Regtest mode),
  and its descriptors import into Bitcoin Core (which has no 12-word import of
  its own).

## Layout

| Folder | What |
|---|---|
| `contract/` | What the app and its Worker agree on: paths, request and answer bodies, error codes, and the closed list of events that may be counted. Plain TypeScript with no imports. |
| `wallet/` | Keys (from a passkey or from random words), addresses, descriptors, the scan of the chain, payments and history. Pure TypeScript on the audited @scure / @noble libraries; no WebAssembly. |
| `app/` | The wallet itself: a single-page app (Svelte 5, Vite, Tailwind CSS 4) in English and Spanish. The rules live in plain modules with tests under `src/lib/` (`session.ts` for keys and storage, `chain-sync.ts` for coins, `faucet-flow.ts` for the faucet); `src/screens/` has one file per screen, `src/strings/` every sentence in both languages, and `dev/` a gallery of every screen in every state. |
| `worker/` | A small Cloudflare Worker for the app's `/api/` and `/p/` paths: the chain's read API, limited to the few shapes the wallet asks for; the faucet, behind a bot check; the address of the pay-it-forward pot; the pot's three counts, which are switched off as shipped (see "The pot's counts" below); and a forwarder for counted events. The built app is served beside it as static files. |
| `e2e/` | The end-to-end tools: a stand-in practice network kept in memory, a local server that runs the Worker's real handler, headless Chrome with virtual passkeys, the smoke command, and the scenarios in `e2e/scenarios/`. |
| `bots/` | The practice network's scripted counterparties: treasury upkeep, the faucet, the pay-it-forward pot, refills and health alerts, with a small API for the Worker. Every key stays in Bitcoin Core's wallets. See `bots/README.md`. |
| `ops/` | The practice network itself: Bitcoin Core (regtest), electrs, a mempool explorer, the block producer, backups, and a Cloudflare tunnel. See `ops/README.md`. |
| `tools/` | `live-check/` looks at a running site from outside (headers, what a search engine may list, the Worker's own answers). `regtest-crosscheck/` holds the wallet library against Bitcoin Core on regtest. `integration/` holds end-to-end checks against the live practice network (the wallet, the public Electrum port, pay-it-forward). `s1-checks/` are the network's first checks. |

## Running it on your own machine

You need Node 22.18 or newer and pnpm 12. The browser tools drive Google
Chrome; set `CHROME_PATH` if yours is not in the usual place on a Mac (the
gallery command reads `CHROME`).

Nothing here needs a secret, an account or the practice network. The app
talks to the Worker's real handler, and the handler to a stand-in network
that lives in memory and starts empty.

```sh
pnpm install
pnpm build    # the app, into app/dist, and a guard over what was built
pnpm dev      # http://localhost:8787
```

`pnpm dev` serves the built app under its real headers, with a stand-in
network that makes a block every 10 seconds and a faucet that pays stand-in
coins. Passkeys work on `localhost`. It is the one command that uses the
network: the page loads Cloudflare's bot check with Cloudflare's published
test key. To work on the app from source, leave it running and start
`pnpm --filter @learnbitcoin/practice-app dev` beside it: the app is then on
http://localhost:5173 and reloads as you type.

The checks:

```sh
pnpm check     # types, in every package
pnpm test      # unit tests, in every package (node --test, which runs TypeScript as it is)
node --test test/     # inside contract/, wallet/, worker/, app/ or e2e/: that package alone
python3 -m unittest discover -s bots/tests

pnpm smoke /wallet/receive --wallet funded --width 375 --shot receive.png
pnpm e2e       # every scenario, in headless Chrome. Run "pnpm build" first.
node --test e2e/scenarios/journey-passkey.test.ts     # one file of scenarios

node tools/live-check/live-check.ts http://localhost:8787     # with "pnpm dev" running
```

`pnpm smoke` opens one page of a fresh build as a browser really gets it, and
fails on any console error, any violation of the page's security policy and
any request to another host. `--wallet` chooses what the browser holds:
`none`, `empty`, `funded` or `passkey`.

`pnpm e2e` runs 223 scenarios in about three minutes. Each gets a
world of its own: the built app, the Worker's handler, a stand-in network,
and pages in Chrome. Most files hold the scenarios of one screen. The files
named `doit-*` hold the "Do it" steps: one file for each step, and one each
for the note of progress, the strip, the reading of a transaction, the
edges, and the link back to the chapter, which is followed to a stand-in
for the main site. The files
named `journey-*` cross the screens: a wallet made with a passkey from Home
to its last payment, the faucet and its bot check, a wallet without a
passkey in Spanish on a phone, restore in a second browser, a stored record
that was altered behind the page, several tabs, and what was counted on the
way. `trust.test.ts` holds what the app says about the bot check and about
its stored record against what happens: it runs a script in the bot check's
place, answers a passkey prompt after that script has come, and alters the
record behind the page. `ways.test.ts` holds what the reader is told between
two screens. `pnpm e2e:live` runs the scenarios that need no stand-in against a real
practice network. It needs that network's origin and its token, which are
not in this repository, and without them it says "not run".

The gallery shows every screen in every state, with a scripted stand-in for
the wallet. It is how the screens were built and looked at:

```sh
pnpm --filter @learnbitcoin/practice-app gallery:dev     # http://localhost:5174/gallery
pnpm --filter @learnbitcoin/practice-app gallery "/es/wallet/receive?state=funded" --width 375 --shot receive.png
```

The second command looks at one page of the gallery in headless Chrome,
under the app's real headers, and saves a picture of it.

## The practice network

A private regtest chain on one small server: Bitcoin Core, electrs (the
Esplora read API for the wallet, Electrum for desktop wallets), a mempool
explorer, and the bots. A block comes every 30 seconds. The faucet pays
100,000 practice sats to an address once a day, after a bot check. Coins a
reader passes on go to the pay-it-forward pot, and the oldest of them goes
out with the next newcomer's faucet payment, so a first coin can be traced on
the explorer to an earlier reader's payment.

Three names are public: the wallet at `practice.learnbitcoin.com`, the
explorer at `practice-explorer.learnbitcoin.com`, and the Electrum port at
`practice-electrum.learnbitcoin.com:50002`. The origin that
serves the chain's read API and the bots is reachable by the Worker alone.
How the network is set up, backed up and checked is in `ops/README.md`; what
the bots do, and their API, in `bots/README.md`.

### The pot's counts

The Worker can tell the app three counts of the pay-it-forward pot: payments
passed on to it, coins that wait in it, and coins it has handed to newcomers.
A done "Pass it on" step shows the first of them in one line.

One setting switches them: `POT_COUNTS` in `worker/wrangler.jsonc`. It is
`"off"` as this repository ships, and `"on"` switches them on. Only the exact
word `on` does. No request can switch it.

- **Off.** The Worker does not know `GET /api/pot/stats`. It answers a request
  for it as it answers any path it does not know, counts nothing at its
  limiter and asks the practice network nothing. `GET /api/config` tells the
  app that the counts cannot be had, and the app does not ask for them: the
  line is left out, and no request for it leaves the page.
- **On.** Anybody can ask for the counts with a plain GET. The Worker does not
  ask the practice network once for each such request. Each running copy of
  the Worker (an isolate, in Cloudflare's word) asks once for all the readers
  it serves, keeps the answer for 15 seconds, and after a question that failed
  asks no other for 5 seconds. That is a bound for each isolate, and
  Cloudflare may run many of them: it is no cap for the Worker as a whole.
  `worker/src/pot-stats.ts` says what it bounds and what it does not.

It ships off because a look at the counts can cost the practice network a
reading of every coin that waits in the pot. The note at the setting says when
it may be switched on. `pnpm dev` and the scenarios run with it off as well,
unless they say otherwise: `POT_COUNTS=on pnpm dev` switches it on for a local
run, and a scenario that reads the count line switches it on in its own
settings.

## Keys

With a passkey, the WebAuthn PRF extension returns 32 secret bytes for a
fixed input; HKDF-SHA256 turns them into 16 bytes of BIP39 entropy, which
encode as 12 words. Without a passkey, the 12 words come from the browser's
random number generator. Either way the account is BIP84 at `m/84'/1'/0'`.
The exact parameters are in `wallet/src/keys.ts` and frozen by test vectors
in `wallet/test/vectors.json`.

### How the wallet keeps its keys

**Watch first, keys on demand.** The browser always keeps the account's
public key. With it the app works out addresses, reads coins and history, and
receives, with no private key and no prompt. Private keys are needed for two
things only: to sign a payment, and to show the 12 words.

**One record.** The wallet keeps one JSON value in the browser's
localStorage, under the key `lbp_wallet_v1`. One browser holds one practice
wallet. The "Do it" steps keep a second value beside it, under
`lbp_progress_v1`, once a reader has opened a step: a note of their progress,
which holds no key and none of the 12 words (the About screen lists what it
does hold, and `app/src/lib/doit/progress.ts` is where it is written). The
app keeps nothing else: no sessionStorage, no IndexedDB, no cookie.

The two kinds of record go by how this browser keeps the wallet, not by how
the wallet was made:

- For a wallet this browser **opens with a passkey**, the record holds
  nothing secret: the public key (enough to list the wallet's addresses and
  coins, not enough to spend them), the wallet fingerprint, the first
  address, and which passkey to ask. The 12 words are made again from the
  passkey at each unlock. They live in the page's memory until the wallet is
  locked, the page is reloaded or the tab is closed, and this record never
  holds them.
- For a wallet **kept with its 12 words** (one made without a passkey, or
  any wallet restored in this browser from its words), the record also holds
  the 12 words, as plain text, with no encryption. Here the record is the
  wallet.

A wallet restored here from its 12 words is kept with the words, whatever it
was made with. So a wallet made with a passkey, removed and then restored
from its words in the same browser, has its words in storage from then on.

Anyone who uses the browser can see the wallet, because the public key is
there. With a wallet kept with its 12 words they can also spend from it.

### Why this is right for play money and wrong for real money

Whoever reads the 12 words owns the wallet, and localStorage can be read by:

- every script that runs on the page's origin: the app's own code, every
  library built into it and every script the page loads;
- browser extensions that are allowed to act on the page;
- anyone who can open the browser profile, and any backup or sync that
  copies it.

One bug that lets a stranger's script run on the page would hand that script
the words.

The app narrows the risk. Its pages come with a strict
Content-Security-Policy: scripts and styles from its own origin only. It
loads no code from anyone else, with one exception, the bot check that guards
the faucet (Cloudflare Turnstile), which loads only when the reader asks for
coins. Before that script is let into the page, a passkey wallet's keys are
dropped and a passkey prompt that is still open is ended, and from then on
every move to another screen loads the page afresh. So the script cannot
read keys that were loaded before it, and the app loads no key again while
the script is in the page.

That is all the lock does, and the app promises no more. While the script is
in the page it could ask the passkey for the wallet's secret itself: what a
passkey is asked with is public, and the passkey's ID is in storage. It
could also open another window of the app and reach into it. Either way the
reader would see a passkey prompt, or a window, that they did not ask for,
and the Receive screen tells them to cancel the one and close the other. (A
wallet kept with its 12 words has them in storage, where that script could
read them. The app says so too.)

Narrowed is not safe. Encrypting the words with a key that the same page can
read would only look safer. The risk is accepted for one reason: these are
practice coins on a private practice network. They have no value, and the
app says so on every screen. The most a thief can take is a practice
session.

A wallet for real money must not do this. Real seed words do not belong in
web storage, and are never typed into a web page, this one included. Chapter
4 of the site's Journey says so, and the screens of this app that show or
take 12 words say why they are the one exception: the words guard play
money. Real words belong on paper or steel, with the keys in a device made
to hold them. Words that have been on this page must never guard real
bitcoin.

The same warning stands at the top of `app/src/lib/keystore.ts`. Read it
before borrowing from that file.

### What leaves the browser

The 12 words never leave the browser. The rest is said to the reader on the
app's About screen, and comes to this:

- The practice server is asked about each of the wallet's addresses, so it
  sees them, and it sees the reader's IP address. For a read of the chain it
  writes no log line, unless something on its own side is broken.
- Screen views, and the events on the closed list in `contract/src/index.ts`,
  are counted when counting is switched on. Each count is a name, a screen's
  fixed path and at most one value from a list; it is passed on to Plausible
  with the IP address and browser name of the request, and no ID.
- The faucet's bot check is Cloudflare's. It loads only when coins are asked
  for, examines the browser, and is given the address the coins are for. Its
  code runs in the page, so it could also read the stored record: the
  wallet's public key, and with it every address of the wallet. It could
  read the note of the "Do it" steps too.
- "Back to the chapter" on a step, and a chapter's name on the list of
  steps, lead to the main site in the same tab. They send no referrer: the
  app's pages are served with `Referrer-Policy: no-referrer`, and no link is
  an exception to it. The address of "Back to the chapter" names the step
  and says whether it is done (`#do-<step>` or `#done=<step>`), and the page
  it leads to is one of the two pages of the step's own chapter, English or
  Spanish. Nothing about the wallet is in it.

## Known limits

- **Long histories.** For one address the wallet reads its newest 1,025
  transactions (50, then 39 pages of 25). Older payments of that address are
  missing from Activity. Coins and the total are read another way and are
  not affected.
- **Very many coins at one address.** The chain index refuses to list the
  unspent coins of an address that holds more of them than its limit (15,000
  on the practice network; 500 is that software's default). A wallet with
  such an address cannot be scanned: its screens show no coins and no total,
  only that the practice network could not answer.
- **Passkeys that give no secret.** A passkey wallet needs the WebAuthn PRF
  extension. Some passkeys hand the secret over only when asked a second
  time; the app asks. Some never do: Create then says so, tells the device to
  drop the passkey where it can, and offers the way without one.
- **A browser can forget.** A wallet kept with its 12 words lives in the
  browser's storage, and a browser can erase that (Safari does after 7 days
  without use). Then only the 12 words on paper bring it back.
- **Not built.** Fee bumping, child-pays-for-parent, multisig, QR scanning,
  and more than one wallet per browser. The page has no button that cancels
  an open passkey prompt: the reader closes it in the browser's own dialog.
  (The app ends an open prompt itself in one case only, before the bot check
  is let into the page.)
- **Browsers not yet tried.** Everything here was run in headless Chrome with
  Chrome's virtual passkey authenticator. Not yet tried: real phones, Safari
  and Firefox, real password managers and security keys, a screen reader
  (only what the page hands one was checked), and Sparrow itself against the
  Electrum port.
- **The Spanish text** is a first draft that no native reviewer has read.

## What is not in this repository

- **No secrets.** The Worker's four secrets (the bot check's secret, the two
  halves of the service token that lets it through to the origin, and the
  bots' token) are named in `worker/wrangler.jsonc` and set on the deployed
  Worker. Their values are written nowhere here. The site key in
  `worker/wrangler.jsonc` is no secret: it is the public half of the
  faucet's bot check, and every reader's browser is sent it. The token and
  site key that appear in `e2e/` belong to the stand-in and to Cloudflare's
  published test widget, and open nothing.
- **No deployment identifiers.** No account, zone or tunnel ID and no server
  address. Host names under `learnbitcoin.com` are public and appear as they
  are.
- **No real keys.** The 12 words in tests and fixtures are the public test
  phrases of the BIP39 standard. Everybody knows them, so they guard nothing
  anywhere.

## How the wallet library was checked

The test vectors are checked independently: the published BIP84 vectors,
HKDF against Python's standard library, and addresses, descriptor checksums
and a signed payment against Bitcoin Core 31.2 on regtest
(`tools/regtest-crosscheck/`).

## License

MIT. See [LICENSE](LICENSE).
