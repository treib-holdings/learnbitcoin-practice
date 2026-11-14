// Presets for the three screens in front of the wallet: Home (/), Create
// (/new) and Restore (/restore).
//
// Most states of these screens need no preset of their own. The base
// presets and the query keys reach them (see the top of stand-in.svelte.ts):
//
//   /?state=none                     no wallet: create, or "I already have one"
//   /?state=words                    a wallet made without a passkey is here
//   /?state=passkey-locked           a wallet made with a passkey is here
//   /new?passkeys=unknown            the passkey button waits
//   /new?passkeys=no                 this browser offers no passkey
//   /new?storage=no                  this browser stores nothing
//   /restore?state=unreadable        what is stored cannot be read (also newer, broken)
//
// What they do not reach is in this file, in two kinds.
//
// States the wallet can be in when one of these screens opens:
//
//   create-unfinished          a passkey was saved and has not given its secret: "Finish setting up"
//   create-unfinished-unnamed  the same, from a passkey whose name is not known
//   restore-empty              typed words found no practice history, and wait for "Keep" or "Erase"
//   home-passkey-unnamed       a passkey wallet whose record holds no tag
//
// States that only show after the reader has done something. These presets
// press the buttons themselves, once the page is drawn, so that one address
// shows what a reader would see after the tap. How the tap ends is said
// with the usual query keys:
//
//   /new?state=tap-create-passkey&create=cancelled      (or timed-out, no-prf, error, busy, reload,
//                                                        broken, unfinished, exists, no-storage)
//   /new?state=tap-create-words&createWords=no-storage  (or exists, reload, broken)
//   /new?state=tap-finish-setup&finish=unfinished       (or error, no-prf, cancelled, exists ...)
//   /restore?state=tap-restore&restore=failed           (or empty, exists, no-storage, reload, broken;
//                                                        add delay=60000 to see the wait itself)
//   /restore?state=tap-restore-unticked                 "Restore" pressed with the box not ticked
//   /restore?state=tap-restore-bad-word                 one word that is not on the list
//   /restore?state=tap-restore-keep&keep=exists         "Keep them here anyway", and a wallet arrived meanwhile
//   /restore?state=tap-restore-keep-refused             the same tap, and the browser would not store the words:
//                                                       they go on waiting, as the real wallet has it (the
//                                                       stand-in's own keep=no-storage lets go of them)
//   /?state=tap-open-passkey&open=cancelled             Home after "Open with my passkey"
//
// A preset that taps does so only on the screen it is for. On any other
// address it is the state without the tap, so the gallery's index, which
// links every preset to every screen, opens no page that fails.

import { parsePath, type Route } from '../../src/lib/router.ts';
import { play, type Step } from '../play.ts';
import { TAG, WORDS } from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';

/** True when the page that is loading shows this screen, in either language. */
function showing(screen: Route['name']): boolean {
  return typeof location !== 'undefined' && parsePath(location.pathname).route.name === screen;
}

/**
 * A preset that puts the wallet in a state (`first`) and then, on `screen`
 * only, plays `steps` on the page once it is drawn. The taps are real
 * clicks (play.ts), answered by the stand-in as the query string says.
 */
function taps(screen: Route['name'], steps: readonly Step[], first: Preset = () => {}): Preset {
  return (wallet) => {
    first(wallet);
    if (!showing(screen)) return;
    // The page is drawn after this preset has run: the steps wait for it.
    setTimeout(() => void play(document.body, steps), 0);
  };
}

const unfinished: Preset = (wallet) => {
  wallet.setup = { tag: TAG };
};

const waitingWords: Preset = (wallet) => {
  wallet.pendingRestore = true;
};

/** The sample words with the third one misspelled: not on the list. */
const BAD_WORDS = WORDS.replace('abandon abandon abandon', 'abandon abandon abandn');

export const presets: Record<string, Preset> = {
  'create-unfinished': unfinished,

  'create-unfinished-unnamed': (wallet) => {
    wallet.setup = { tag: null };
  },

  'restore-empty': waitingWords,

  'home-passkey-unnamed': (wallet: StandIn) => {
    wallet.haveWallet('passkey');
    // The factory lays the sample record over a preset's wallet once the
    // preset has run, so the tag is taken off after that.
    setTimeout(() => {
      if (wallet.record === null) return;
      const { tag: _tag, ...rest } = wallet.record;
      wallet.record = rest;
    }, 0);
  },

  'tap-create-passkey': taps('new', [{ tap: 'create-passkey' }]),
  'tap-create-words': taps('new', [{ tap: 'create-words' }]),
  'tap-finish-setup': taps('new', [{ tap: 'finish-setup' }], unfinished),

  'tap-restore': taps('restore', [{ words: WORDS }, { tap: 'restore-check' }, { tap: 'restore-go' }]),
  'tap-restore-unticked': taps('restore', [{ words: WORDS }, { tap: 'restore-go' }]),
  'tap-restore-bad-word': taps('restore', [{ words: BAD_WORDS }, { leave: 3 }, { tap: 'restore-check' }, { tap: 'restore-go' }]),
  'tap-restore-keep': taps('restore', [{ tap: 'restore-keep' }], waitingWords),
  'tap-restore-keep-refused': taps('restore', [{ tap: 'restore-keep' }], (wallet) => {
    waitingWords(wallet);
    wallet.keepRestored = () => 'no-storage';
  }),

  'tap-open-passkey': taps('home', [{ tap: 'open-passkey' }]),
};
