// The router's live part: it follows the address bar.
//
// `router.route` and `router.lang` are reactive: anything that reads them is
// redrawn when the address changes. Links stay plain <a href="/wallet/send">
// elements. One click listener on the document turns a click on a link to
// one of the app's own screens into a history entry, so no page is loaded
// and the wallet stays as it is. The same listener stops the second click
// of a double tap on any link: by then the first click may have changed
// the screen, and the link under the reader's finger is one they never
// chose. What the router decides is in navigation.ts, where "node --test"
// checks every rule.
//
// How a screen uses it:
//   router.lang, router.route      which language, which screen (reactive)
//   router.link({ name: 'send' })  the address of a screen in this language, for href
//   navigate('/wallet/backup')     go to a screen from code
//   focusHeading()                 after a step swapped in place: await tick() first
//
// One more thing is main.ts's alone: it hands fullLoadsFromNowOn() to the
// wallet, which calls it when a screen says the bot check is about to load
// (wallet.beforeBotCheck()). A screen never calls it itself.

import { tick } from 'svelte';
import { on } from 'svelte/events';
import { entryIndex, judgeClick, judgeMove, judgePop } from './navigation.ts';
import { parsePath, pathFor, type Lang, type Route } from './router.ts';

/** What is stored with each history entry. */
interface EntryState {
  /** The entry's place in this tab's history, counted by the router. */
  index: number;
}

class Router {
  #path = $state(location.pathname);
  #search = $state(location.search);
  #parsed = $derived(parsePath(this.#path));

  #index = 0;
  /** Scroll offsets by history index, so Back returns to where the reader was. */
  #scroll = new Map<number, number>();
  /** True once the bot check's script is in the page: every move then loads a page. */
  #fullLoads = false;
  /**
   * The part of the new screen that the last move asked for ("faucet" for an
   * address that ends "#faucet"), until the piece that is that part has taken
   * it. Set by a move to another screen and by the page's own first address,
   * never by Back or Forward: those return to where the reader was.
   */
  #wantedPart = '';

  /** The screen the address asks for. */
  get route(): Route {
    return this.#parsed.route;
  }

  /** The language the address asks for. */
  get lang(): Lang {
    return this.#parsed.lang;
  }

  /** The path in the address bar, as it stands: "/es/wallet/send". */
  get path(): string {
    return this.#path;
  }

  /** The query string in the address bar, such as "?state=funded", or "". */
  get search(): string {
    return this.#search;
  }

  /**
   * The address of a screen in the language that is showing, for a link:
   * href={router.link({ name: 'send' })}. A link written without it would
   * drop a Spanish reader into English.
   */
  link(route: Route): string {
    return pathFor(route, this.lang);
  }

  /** Call once, before the app is mounted. Returns a function that undoes it. */
  start(): () => void {
    // The router puts the scroll position back itself, after the screen is drawn.
    history.scrollRestoration = 'manual';
    const index = entryIndex(history.state);
    if (index !== null) this.#index = index;
    else history.replaceState({ index: this.#index } satisfies EntryState, '');
    document.documentElement.lang = this.lang;
    this.#wantedPart = partOf(location.hash);

    // "on" and not addEventListener: it keeps this listener in step with
    // the handlers Svelte attaches, so a component's own onclick that calls
    // preventDefault() is seen here as a click already dealt with.
    const offPop = on(window, 'popstate', (event) => this.#onPop(event));
    const offHash = on(window, 'hashchange', () => this.#onHash());
    const offClick = on(document, 'click', (event) => this.#onClick(event));
    return () => {
      offPop();
      offHash();
      offClick();
    };
  }

  /**
   * Go to another screen. `replace` swaps the current history entry instead
   * of adding one, so Back does not return to the screen being left.
   */
  navigate(to: string, options: { replace?: boolean } = {}): void {
    const move = judgeMove(to, location.href, options.replace === true, this.#fullLoads);
    switch (move.kind) {
      case 'stay':
        return;
      case 'load':
        location.assign(move.url);
        return;
      case 'load-replace':
        location.replace(move.url);
        return;
      case 'replace':
        history.replaceState({ index: this.#index } satisfies EntryState, '', move.url);
        break;
      case 'push':
        this.#scroll.set(this.#index, window.scrollY);
        this.#index += 1;
        history.pushState({ index: this.#index } satisfies EntryState, '', move.url);
        break;
    }
    this.#wantedPart = partOf(location.hash);
    void this.#show(0);
  }

  /**
   * For a piece that is a named part of its screen (the faucet on Receive,
   * "#faucet"): true, once, when the move that opened the screen asked for
   * that part. The piece then brings itself on screen and takes focus (see
   * FaucetCard.svelte for when). The router itself always opens a screen at
   * its top with focus on its heading, because a part may not be drawn yet
   * when the screen opens: the faucet waits for the wallet's first look at
   * its coins.
   */
  takePart(id: string): boolean {
    if (id === '' || this.#wantedPart !== id) return false;
    this.#wantedPart = '';
    return true;
  }

  /**
   * Moves keyboard and screen-reader focus to the screen's heading, and
   * brings the heading into view. For a step that swaps in place (the review
   * of a payment, "sent", an unlock): change the state, await tick(), then
   * call this, so the new step is announced and Tab starts from its top.
   */
  focusHeading(): void {
    const heading = this.#heading();
    if (!heading) return;
    heading.focus({ preventScroll: true });
    // "nearest": no jump when the heading is already on screen.
    heading.scrollIntoView({ block: 'nearest' });
  }

  /**
   * From now on, navigate() and clicks on links load a whole page, so the
   * bot check's script is gone again as soon as the reader moves to another
   * screen. Only a page load undoes it.
   *
   * No screen calls this. main.ts hands it to the wallet, and the wallet
   * calls it when a screen tells it that the bot check is about to load
   * (wallet.beforeBotCheck()): one owner, so the two can never be out of step.
   */
  fullLoadsFromNowOn(): void {
    this.#fullLoads = true;
  }

  /** True after fullLoadsFromNowOn(). */
  get fullLoads(): boolean {
    return this.#fullLoads;
  }

  #heading(): HTMLElement | null {
    return document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main');
  }

  /** Follows the address bar to the screen it now names, then sets scroll and focus. */
  async #show(scrollTop: number): Promise<void> {
    this.#path = location.pathname;
    this.#search = location.search;
    document.documentElement.lang = this.lang;
    // Wait until Svelte has put the new screen in the document.
    await tick();
    window.scrollTo(0, scrollTop);
    // Focus goes to the new screen's heading, so the change of screen is
    // announced and Tab starts from the top of it. The scroll position set
    // above stays as it is.
    this.#heading()?.focus({ preventScroll: true });
  }

  /** Back and Forward. What they mean is judgePop's to say (navigation.ts). */
  #onPop(event: PopStateEvent): void {
    const sameAddress = location.pathname === this.#path && location.search === this.#search;
    const verdict = judgePop(entryIndex(event.state), this.#index, sameAddress, this.#fullLoads);
    // Only the "#part" changed (a link the browser followed by itself): the
    // same screen is showing, and where it scrolls to is the browser's call.
    if (verdict.kind === 'stay') return;
    // After the bot check, Back and Forward load a page like every other move.
    if (verdict.kind === 'load') {
      location.reload();
      return;
    }
    this.#scroll.set(this.#index, window.scrollY);
    // Back and Forward return to where the reader was, not to a part an earlier move asked for.
    this.#wantedPart = '';
    // An entry with no place in the count has no saved scroll position
    // either: its screen opens at the top.
    if (verdict.index === null) {
      void this.#show(0);
      return;
    }
    this.#index = verdict.index;
    void this.#show(this.#scroll.get(this.#index) ?? 0);
  }

  /**
   * The "#part" of the address changed. When the browser followed a link to
   * a part by itself, it made a history entry of its own, which the router
   * has not counted. That entry gets the next place here, at once, so that
   * Back and Forward through it keep the count right. (Back or Forward to an
   * entry that has a place already has been seen to by #onPop.)
   */
  #onHash(): void {
    if (entryIndex(history.state) !== null) return;
    this.#scroll.set(this.#index, window.scrollY);
    this.#index += 1;
    history.replaceState({ index: this.#index } satisfies EntryState, '');
  }

  #onClick(event: MouseEvent): void {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest('a[href]') : null;
    const link =
      anchor instanceof HTMLAnchorElement
        ? { href: anchor.href, target: anchor.target, download: anchor.hasAttribute('download'), rel: anchor.rel }
        : null;
    const verdict = judgeClick(event, link, location.href, this.#fullLoads);
    if (verdict.kind === 'leave') return;
    if (verdict.kind === 'drop') {
      // The second click of a double tap follows no link (navigation.ts says
      // why): not through the router, and not through the browser either.
      event.preventDefault();
      return;
    }
    if (verdict.kind === 'part') {
      // Another part of this screen, such as "Skip to content": go there
      // without adding a history entry.
      const part = document.getElementById(verdict.id);
      if (!part) return;
      event.preventDefault();
      part.scrollIntoView();
      part.focus({ preventScroll: true });
      return;
    }
    event.preventDefault();
    this.navigate(verdict.to);
  }
}

/** The part an address names: "faucet" for "#faucet", "" for none or for one that cannot be read. */
function partOf(hash: string): string {
  try {
    return decodeURIComponent(hash.replace('#', ''));
  } catch {
    return '';
  }
}

/** The one router of the page. */
export const router = new Router();

/** Go to another screen: router.navigate. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  router.navigate(to, options);
}

/** Focus the screen's heading after a step swapped in place: router.focusHeading. */
export function focusHeading(): void {
  router.focusHeading();
}
