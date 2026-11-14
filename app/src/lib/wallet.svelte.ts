// The wallet as the screens see it: `wallet`, the one object that satisfies
// WalletApi (wallet-api.ts).
//
// Nothing is decided here. The rules live in three plain modules that
// node --test can run: session.ts (keys, storage, other tabs), chain-sync.ts
// (the coins) and faucet-flow.ts (the faucet). This file does three small
// things for them:
//
//   1. It hands them the browser: storage, passkeys, fetch, timers, the clock.
//   2. It copies what they publish into Svelte state, one variable for each
//      property of WalletApi, so a screen that reads `wallet.status` in its
//      markup follows the wallet, and is redrawn only when that one value
//      has changed.
//   3. It passes each action on to the module that owns it.
//
// Only main.ts imports this file. Screens get the object through
// useWallet() (wallet-context.ts).
//
// Importing it builds the wallet at once and reads the stored record before
// the first screen is drawn, so nothing flickers from "no wallet" to "a
// wallet". It must not throw while doing so: a browser with storage switched
// off, or without passkeys, still gets a page that says what is missing.

import type { AppConfig } from '@learnbitcoin/practice-contract';
import { makeApi } from './api.ts';
import { withDeadline } from './chain-sync.ts';
import { DEFAULT_CONFIG, loadConfig } from './config.ts';
import { initEvents, track } from './events.ts';
import type { PasskeyEnv, PublicKeyCredentialLike } from './passkey.ts';
import { parsePath } from './router.ts';
import { makeEngine, passkeyPort } from './session.ts';
import type { WalletApi } from './wallet-api.ts';

// -- the browser's objects, each read so that a missing one cannot stop the page ----

/** Stands in when the browser will not hand out localStorage at all: every use fails, as a blocked storage does. */
function noStorage(): Storage {
  const blocked = (): never => {
    throw new DOMException('Storage is not available', 'SecurityError');
  };
  return { length: 0, clear: blocked, getItem: blocked, key: blocked, removeItem: blocked, setItem: blocked };
}

/** localStorage. With cookies blocked, some browsers throw on the mere mention of it. */
function browserStorage(): Storage {
  try {
    return window.localStorage ?? noStorage();
  } catch {
    return noStorage();
  }
}

/** What passkey.ts needs. On a page that is not secure, or in a browser without passkeys, two of these are undefined. */
function passkeyEnv(): PasskeyEnv {
  return {
    credentials: navigator.credentials,
    PublicKeyCredential: (window as { PublicKeyCredential?: PublicKeyCredentialLike }).PublicKeyCredential,
    crypto: window.crypto,
    isSecureContext: window.isSecureContext,
    hostname: location.hostname,
  };
}

/** Asks the browser to keep this site's data. Null where it cannot be asked. */
async function persistStorage(): Promise<boolean | null> {
  const storage = navigator.storage;
  if (!storage || typeof storage.persist !== 'function') return null;
  return storage.persist();
}

/**
 * The browser's fetch, with a time limit on every request: a request that
 * gets no answer is given up, and reads as "no answer" (withDeadline in
 * chain-sync.ts says why, and how long). AbortSignal.timeout makes the
 * signal that ends a request. The settings and the client both use this.
 */
const boundedFetch = withDeadline(
  (input, init) => fetch(input, init),
  (ms) => AbortSignal.timeout(ms),
);

// -- the engine ---------------------------------------------------------------

const local = browserStorage();

/** The settings: the built-in ones until the Worker's arrive. A copy, because the built-in object is frozen. */
let config = $state.raw<AppConfig>({ ...DEFAULT_CONFIG });

const engine = makeEngine({
  local,
  passkeys: passkeyPort(passkeyEnv()),
  api: makeApi(boundedFetch),
  now: () => Date.now(),
  timers: {
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (handle) => window.clearTimeout(handle as number),
  },
  visible: () => document.visibilityState !== 'hidden',
  track,
  persist: persistStorage,
  // A new passkey is named in the language of the page it is made on.
  lang: () => parsePath(location.pathname).lang,
  blockSeconds: () => config.blockSeconds,
});

// -- what the modules publish, copied into Svelte state ------------------------
//
// $state.raw: these values are replaced whole and never changed in place, and
// some are large (every coin of the wallet). Assigning a variable the value
// it already holds tells nobody, so each property changes on its own.

const session = engine.session.view();
let status = $state.raw(session.status);
let record = $state.raw(session.record);
let unlocked = $state.raw(session.unlocked);
let passkeyOffered = $state.raw(session.passkeyOffered);
let canStore = $state.raw(session.canStore);
let persisted = $state.raw(session.persisted);
let setup = $state.raw(session.setup);
let created = $state.raw(session.created);
let pendingSwitch = $state.raw(session.pendingSwitch);
let pendingRestore = $state.raw(session.pendingRestore);
let openedEmpty = $state.raw(session.openedEmpty);

const coins = engine.chain.view();
let chain = $state.raw(coins.chain);
let history = $state.raw(coins.history);
let historyError = $state.raw(coins.historyError);
let receive = $state.raw(coins.receive);
let notice = $state.raw(coins.notice);

let faucet = $state.raw(engine.faucet.view());

engine.session.subscribe(() => {
  const now = engine.session.view();
  status = now.status;
  record = now.record;
  unlocked = now.unlocked;
  passkeyOffered = now.passkeyOffered;
  canStore = now.canStore;
  persisted = now.persisted;
  setup = now.setup;
  created = now.created;
  pendingSwitch = now.pendingSwitch;
  pendingRestore = now.pendingRestore;
  openedEmpty = now.openedEmpty;
});

engine.chain.subscribe(() => {
  const now = engine.chain.view();
  chain = now.chain;
  history = now.history;
  historyError = now.historyError;
  receive = now.receive;
  notice = now.notice;
});

engine.faucet.subscribe(() => {
  faucet = engine.faucet.view();
});

// -- what the browser tells the engine -------------------------------------------

// Another tab made, changed or removed the wallet. (The event never fires in the tab that did it.)
window.addEventListener('storage', (event) => {
  if (event.storageArea === local) engine.session.storageChanged(event.key);
});

// A hidden tab reads nothing. Back in view, it looks once, at once.
document.addEventListener('visibilitychange', () => {
  engine.chain.visibilityChanged();
});

// -- the settings ----------------------------------------------------------------

void loadConfig(boundedFetch).then((loaded) => {
  // Counting is switched on or left off before any screen can see the settings that say which.
  // App.svelte sends the screen views, from the route, once config.events is true.
  initEvents(loaded.events);
  config = loaded;
  // Whether passkeys are offered depends on the host the settings name.
  void engine.session.learnPasskeys(loaded.passkeyHost);
});

// -- the bot check and the router ------------------------------------------------------

const botCheckListeners: (() => void)[] = [];
/** True once the listeners have been told. It stays true: only a reload gets rid of the bot check's script. */
let botCheckTold = false;

/**
 * For main.ts, which is the one file that sees both the wallet and the
 * router: `listener` is called when a screen calls wallet.beforeBotCheck(),
 * or asks the faucet without having called it. From that moment every move
 * between screens has to be a full page load, so that the bot check's script
 * is gone before any key is loaded again. Only the router can make it so,
 * and the wallet has no other way to tell it. Each listener is told once.
 */
export function onBotCheck(listener: () => void): void {
  botCheckListeners.push(listener);
  // Added after the fact: told at once.
  if (botCheckTold) tell(listener);
}

function tell(listener: () => void): void {
  try {
    listener();
  } catch {
    // The keys are dropped all the same.
  }
}

function beforeBotCheck(): void {
  // Keys first: whatever a listener does, the script never meets them.
  engine.session.beforeBotCheck();
  // Called again (a second request to the faucet, a fresh token): the router knows already.
  if (botCheckTold) return;
  botCheckTold = true;
  for (const listener of botCheckListeners) tell(listener);
}

// -- the object the screens use ----------------------------------------------------

export const wallet: WalletApi = {
  get status() {
    return status;
  },
  get record() {
    return record;
  },
  get unlocked() {
    return unlocked;
  },
  get config() {
    return config;
  },
  get passkeyOffered() {
    return passkeyOffered;
  },
  get canStore() {
    return canStore;
  },
  get persisted() {
    return persisted;
  },
  get setup() {
    return setup;
  },
  get created() {
    return created;
  },
  get pendingSwitch() {
    return pendingSwitch;
  },
  get pendingRestore() {
    return pendingRestore;
  },
  get openedEmpty() {
    return openedEmpty;
  },
  get chain() {
    return chain;
  },
  get history() {
    return history;
  },
  get historyError() {
    return historyError;
  },
  get receive() {
    return receive;
  },
  get faucet() {
    return faucet;
  },
  get notice() {
    return notice;
  },

  createWithPasskey: () => engine.session.createWithPasskey(),
  finishSetup: () => engine.session.finishSetup(),
  createWithWords: () => engine.session.createWithWords(),
  ackCreated: () => engine.session.ackCreated(),
  openWithPasskey: () => engine.session.openWithPasskey(),
  unlock: (how) => engine.session.unlock(how),
  unlockWithWords: (words) => engine.session.unlockWithWords(words),
  confirmSwitch: () => engine.session.confirmSwitch(),
  cancelSwitch: () => engine.session.cancelSwitch(),
  checkWords: (input) => engine.session.checkWords(input),
  restore: (words) => engine.session.restore(words),
  keepRestored: () => engine.session.keepRestored(),
  eraseRestored: () => engine.session.eraseRestored(),

  lock: () => engine.session.lock(),
  revealWords: () => engine.session.revealWords(),
  removeWallet: () => engine.session.removeWallet(),
  descriptors: () => engine.session.descriptors(),

  watch: (screen) => engine.chain.watch(screen),
  refresh: () => engine.chain.refresh(),
  lookupTx: (txid) => engine.chain.lookupTx(txid),

  newReceiveAddress: () => engine.chain.newReceiveAddress(),
  beforeBotCheck,
  // The token source is the bot check. A screen calls beforeBotCheck() before it adds the bot
  // check's script to the page. Should one forget, the same happens here before the check runs:
  // the keys are dropped (the engine sees to that by itself as well) and the router is told.
  askFaucet: (getToken) =>
    engine.faucet.ask((fresh) => {
      beforeBotCheck();
      return getToken(fresh);
    }),

  plan: (request) => engine.chain.plan(request),
  sign: (request) => engine.session.sign(request),
  broadcast: (payment) => engine.chain.broadcast(payment),
  potAddress: () => engine.chain.potAddress(),
};
