// Every string table of the app in one map: strings.<area>[lang].<key>.
//
// A screen reads its own area and "common"; test/strings.test.ts walks the
// whole map and holds every table to the rules written at the top of
// common.ts.

import * as about from './about.ts';
import * as backup from './backup.ts';
import * as common from './common.ts';
import * as create from './create.ts';
import * as errors from './errors.ts';
import * as home from './home.ts';
import * as receive from './receive.ts';
import * as restore from './restore.ts';
import * as send from './send.ts';
import * as settings from './settings.ts';
import * as sparrow from './sparrow.ts';
import * as wallet from './wallet.ts';

export const strings = {
  /** The shell: the PRACTICE marker, units, section names, footer, passkey names. */
  common: { en: common.en, es: common.es },
  /** A sentence for every failure. The top of errors.ts says how to find one. */
  errors: { en: errors.en, es: errors.es },
  home: { en: home.en, es: home.es },
  create: { en: create.en, es: create.es },
  wallet: { en: wallet.en, es: wallet.es },
  receive: { en: receive.en, es: receive.es },
  send: { en: send.en, es: send.es },
  backup: { en: backup.en, es: backup.es },
  restore: { en: restore.en, es: restore.es },
  settings: { en: settings.en, es: settings.es },
  sparrow: { en: sparrow.en, es: sparrow.es },
  about: { en: about.en, es: about.es },
} as const;

/** The name of one table: "common", "errors" or a screen's. */
export type Area = keyof typeof strings;
