// What the Sparrow page shows that is not a sentence: the commands that
// start Sparrow in Regtest mode, where Sparrow comes from, and what stands
// in step 5 where the links into this browser's wallet would be, when this
// browser has no wallet it can use.
//
// Sparrow is another publisher's program. Every fact about it on the page
// was read in Sparrow's own documentation and code, and this is where:
//
//   FAQ     sparrowwallet.com/docs/faq.html, "How can I run testnet?"
//   README  github.com/sparrowwallet/sparrow, README.md, "Configuration"
//   guide   sparrowwallet.com/docs/quick-start.html
//   code    the same repository (AppController.java, app.fxml, the server
//           and wallet settings screens) and its library, "drongo"
//           (Network.java, OutputDescriptor.java)
//
// The flag. FAQ and README: the option "--network, -n" takes mainnet,
//   testnet, regtest or signet (the README adds testnet4).
// The commands. The FAQ gives one for each system, with testnet as its
//   example: "Sparrow/bin/Sparrow -n testnet" for Linux and
//   "Sparrow.exe -n testnet" for Windows. The Linux and Windows lines below
//   are those two with regtest in testnet's place. Nobody here has run
//   them, and the page says so beside each. The macOS line is the one the
//   site's owner ran by hand.
// No Regtest on the menu. Code: the "Restart In" menu is built from
//   mainnet, testnet, testnet4 and signet. Nor does Sparrow read a marker
//   file for regtest, as it does for those: the flag (or the environment
//   variable SPARROW_NETWORK) is the only way in.
// The mark. Code: when the network is not mainnet, its name ("Regtest") is
//   drawn at the right end of the row of wallet tabs. Nobody here has seen
//   it on a screen, so the page says it "should" say Regtest, and the check
//   that settles the matter is the addresses.
// The prefix. Library: regtest addresses start "bcrt", every other test
//   network's start "tb", and Bitcoin's own start "bc".
// The descriptor. Code: a wallet's Settings tab has "Edit..." beside
//   "Descriptor"; a descriptor whose path ends in "0/*" gives the receive
//   addresses, and Sparrow reads the change addresses from the same key
//   with "1/*". So the receive descriptor alone is enough.
// The 12 words. Guide: "New or Imported Software Wallet", "Mnemonic Words
//   (BIP39)", and a look at the derivation path before the keystore is
//   imported. Code (control/MnemonicKeystorePane.java): the button reads
//   "Use 24 Words", and its list holds "Use 12 Words". Here the guide lags
//   the program: it still prints "Enter 24 Words" and "Enter 12 Words",
//   which the program showed up to version 1.5.6 and has not shown since
//   1.6.0. The page writes what the program shows.
// The port. Code (settings/server.fxml): the port is a box beside "URL:"
//   with no label of its own, so the page gives it no label of Sparrow's.

import type { WalletStatus } from '../../lib/wallet-api.ts';

/** The flag that starts Sparrow in Regtest mode. Sparrow's menu has no entry that does. */
export const REGTEST_FLAG = '-n regtest';

/** The page of Sparrow's publisher that offers the program and says how to verify the download. */
export const SPARROW_DOWNLOAD_URL = 'https://sparrowwallet.com/download/';

/** The systems Sparrow is made for, in the order the page shows them. */
export type System = 'macos' | 'windows' | 'linux';

export interface StartCommand {
  system: System;
  /** The whole line, exactly as it is typed. The page shows it and copies it, and nothing else. */
  command: string;
  /**
   * How we know the line: "ran" for one the site's owner has run,
   * "documented" for one that follows Sparrow's own documentation and has
   * not been run here. The page says which beside each command.
   */
  proof: 'ran' | 'documented';
}

/** One command for each system. Each ends with the flag. */
export const START_COMMANDS: readonly StartCommand[] = [
  { system: 'macos', command: `open -a Sparrow --args ${REGTEST_FLAG}`, proof: 'ran' },
  { system: 'windows', command: `Sparrow.exe ${REGTEST_FLAG}`, proof: 'documented' },
  { system: 'linux', command: `Sparrow/bin/Sparrow ${REGTEST_FLAG}`, proof: 'documented' },
];

/**
 * Why step 5 cannot link into this browser's wallet, when it cannot:
 *
 *   none        there is no wallet here yet: create or open one first
 *   unreadable  something is stored that cannot be read: the wallet's own
 *               screen offers Reload and Remove
 *   newer       the page is out of date: reload
 *   broken      the self-test failed: no wallet can be used in this browser
 *   blocked     the browser did not let this page read its storage: whether
 *               a wallet is here is not known. Allow site data, and reload
 */
export type WalletNote = 'none' | 'unreadable' | 'newer' | 'broken' | 'blocked';

/**
 * What stands in step 5 for a wallet in this state. Null: a wallet is here,
 * and the links to Settings and Backup work. Every status is named, so a
 * status added to the wallet later does not build until it has a line here.
 */
export function walletNote(status: WalletStatus): WalletNote | null {
  switch (status) {
    case 'ready':
      return null;
    case 'none':
      return 'none';
    case 'unreadable':
      return 'unreadable';
    case 'newer':
      return 'newer';
    case 'broken':
      return 'broken';
    case 'blocked':
      return 'blocked';
  }
}
