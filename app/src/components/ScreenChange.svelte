<script lang="ts">
  // Marks the moment one screen gives way to another, for the app's
  // counter (lib/events.ts). It draws nothing. App.svelte puts one in front
  // of every screen, in the same block as the screen, so that it comes and
  // goes with it.
  //
  // What the app counts is filed under the screen that is showing. When
  // the address changes, App.svelte names the new screen at once, before
  // anything of it is drawn: what the new screen counts while it starts is
  // then its own. But the old screen is still to be taken off the page,
  // and may count something as it goes. Restore does: it lets go of typed
  // words that the reader walked away from, and "erased" is counted. That
  // belongs to Restore, not to the screen the reader went to.
  //
  // So this piece says when the old screen's last moment begins and when
  // it is over. It stands first in its block, and Svelte takes a block
  // apart in the order it was put together: this piece's parting word
  // comes before the screen's own. And the piece that comes with the new
  // screen says "arrived" before that screen's first work after it is on
  // the page (its onMount), for the same reason.
  //
  // It says "arrived" as it is made, too. Svelte puts the new screen on the
  // page before it takes the old one off; should that order ever be the
  // other way round, the old screen's parting is over by then, and this
  // call ends it.
  //
  // And it counts the screens (screen-count.ts), for the pieces whose work
  // can outlive their screen: a passkey prompt's answer must not be handed
  // to a screen that is no longer the one on the page.

  import { onDestroy } from 'svelte';
  import { screenArrived, screenLeaving } from '../lib/events.ts';
  import { screenPutOnPage } from './screen-count.ts';

  screenPutOnPage();
  screenArrived();

  // The screen this piece stands with is leaving: from here on, until the
  // next screen has arrived, what is counted is this screen's.
  onDestroy(screenLeaving);

  // The first effect of the new block to run once the page has been redrawn: the old screen is gone.
  $effect(() => {
    screenArrived();
  });
</script>
