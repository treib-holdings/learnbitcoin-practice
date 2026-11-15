// What the reader typed into the Send form, kept for as long as the page
// lives, so that a reader who leaves the screen and comes back finds it.
//
// The browser's Back button at the unlock step or at the review leaves Send
// altogether (the steps are swapped in place and have no history entries of
// their own), and so does a tap on another section. Without this, Forward
// came back to an empty form: the address and the amount were gone without
// a word.
//
// Only what was typed is kept: the address, the amount, whether "Send all"
// was ticked, the fee rate, and the pot address "Pass it on" filled in
// (the wallet counts a payment to that address as passed on). Never the
// signed payment: that is dropped with the review, on purpose.
//
// It is kept in this page's memory and nowhere else, so a page load forgets
// it. It belongs to one wallet, named by its public key: after a remove and
// a restore the form of the wallet before is not shown to the next one, and
// is forgotten the moment the next one asks. And it is forgotten once the
// payment has been sent.

/** The form's fields, as text. */
export interface KeptForm {
  to: string;
  amount: string;
  sendAll: boolean;
  fee: string;
  /** The pot address the wallet last gave, when "Pass it on" was used. */
  pot: string | null;
}

let kept: { wallet: string; form: KeptForm } | null = null;

/** Keeps the form as it stands, for the wallet with this public key. */
export function keepForm(wallet: string, form: KeptForm): void {
  kept = { wallet, form: { ...form } };
}

/**
 * The form that was kept for this wallet, or null: nothing was kept, or it
 * was another wallet's. What another wallet typed is forgotten then: that
 * wallet is no longer the one in this browser.
 */
export function keptForm(wallet: string | null): KeptForm | null {
  if (kept === null) return null;
  if (wallet === null || kept.wallet !== wallet) {
    kept = null;
    return null;
  }
  return { ...kept.form };
}

/** Forgets what was kept: the payment has been sent, or no wallet is here. */
export function forgetForm(): void {
  kept = null;
}
