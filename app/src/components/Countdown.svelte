<script lang="ts">
  // Counts down to a time, in whole seconds and then whole minutes: "12
  // seconds", "2 minutes". It is for the waits the app takes by itself: the
  // next try after a failed refresh, the faucet asking again.
  //
  // `text` is the screen's own sentence with a {time} slot, such as "Asking
  // again in {time}."; without it the piece shows the time alone. A screen
  // reader is not told every second: the element is a timer, which is read
  // when the reader gets to it and not each time it changes.
  //
  // Once the time is reached the piece draws nothing, and it draws nothing
  // for a time that has already passed. What was waited for is then due, or
  // is not coming (a hidden tab asks for nothing): "in 0 seconds" that stays
  // on screen would be wrong either way. So put it where an empty place does
  // no harm: straight into a row or a column, not alone inside a paragraph.

  import { fill } from '../lib/format.ts';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';
  import { timeLeft, timeLeftKey } from './text.ts';

  interface Props {
    /** The time counted down to, in milliseconds since 1970. */
    to: number;
    /** A sentence with a {time} slot. */
    text?: string;
    /** Called once, when the time is reached. Not called for a time that has already passed when the piece is drawn. */
    ondone?: () => void;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { to, text, ondone, class: extra = '', ...rest }: Props = $props();

  let t = $derived(strings.common[router.lang]);

  let now = $state(Date.now());
  let left = $derived(timeLeft(to, now));
  let time = $derived(fill(t[timeLeftKey(left)], { count: String(left.count) }));

  // A clock is outside Svelte, so an effect follows it: one tick a second
  // until the time is reached, and again from the start when `to` changes.
  // The effect only ever writes `now`. If it also read it, every tick would
  // start the effect again.
  $effect(() => {
    const target = to;
    const reached = (): boolean => {
      const current = Date.now();
      now = current;
      return current >= target;
    };
    // Already past when the piece is drawn: nothing to wait for, and nobody to tell.
    if (reached()) return;
    const timer = setInterval(() => {
      if (!reached()) return;
      clearInterval(timer);
      ondone?.();
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

{#if left.count > 0}
  <span {...rest} role="timer" aria-live="off" class={['tabular-nums', extra]}
    >{text === undefined ? time : fill(text, { time })}</span
  >
{/if}
