<script lang="ts">
  // A button, in the three weights the app uses.
  //
  //   primary    the one thing this step is for: at most one on a screen step
  //   secondary  the other way on, or the way back
  //   quiet      a small action beside something: Copy, Lock, Show a new address
  //
  // With `href` it is a link that looks like a button: use that for anything
  // that goes to another screen, so it can be opened in a new tab.
  //
  // `busy` is for the moment after a tap, while the wallet works: the button
  // keeps its place and its focus, says `busyText` if given, and ignores
  // further taps. `disabled` is for a step that cannot be taken yet. Both
  // hold for a link as well: a disabled link goes nowhere and takes no
  // click, and a screen reader is told that it is switched off.
  // Attributes such as data-testid and aria-describedby pass through.

  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { BUTTON, FOCUS } from './styles.ts';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'class' | 'children' | 'onclick'> {
    variant?: 'primary' | 'secondary' | 'quiet';
    /** A primary button at the size of a quiet one, for use inside a card. */
    small?: boolean;
    /** Makes it a link to this address. */
    href?: string;
    /** The wallet is working on what this button started. */
    busy?: boolean;
    /** What the button says while busy, such as "Sending...". Without it the label stays. */
    busyText?: string;
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    /** Extra classes, for spacing and width. */
    class?: string;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    small = false,
    href,
    busy = false,
    busyText,
    disabled = false,
    onclick,
    class: extra = '',
    children,
    ...rest
  }: Props = $props();

  let look = $derived(variant === 'primary' && small ? BUTTON.primarySmall : BUTTON[variant]);

  // Never wider than what holds it: a long label wraps onto a second line
  // instead of pushing the page wider than a phone's screen.
  const SHAPE = 'inline-block max-w-full text-center';

  function click(event: MouseEvent): void {
    // A busy button stays in the tab order, so a tap can still reach it. So
    // can a tap on a disabled link, which is no button the browser switches off.
    if (busy || disabled) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }
</script>

{#if href !== undefined}
  <!-- A link that is switched off has no address: the browser then follows
       nothing and gives it no place in the Tab order, as with a disabled
       button. role="link" keeps it a link for a screen reader, which reads
       aria-disabled as "unavailable". -->
  <a
    {...rest}
    href={disabled ? undefined : href}
    role={disabled ? 'link' : rest.role}
    aria-busy={busy ? 'true' : undefined}
    aria-disabled={disabled || busy ? 'true' : undefined}
    class={[SHAPE, disabled && 'opacity-50', busy && 'cursor-progress', look, FOCUS, extra]}
    onclick={click}
  >
    {#if busy && busyText}{busyText}{:else}{@render children()}{/if}
  </a>
{:else}
  <button
    {...rest}
    type="button"
    {disabled}
    aria-busy={busy ? 'true' : undefined}
    aria-disabled={busy ? 'true' : undefined}
    class={[SHAPE, 'disabled:opacity-50', busy && 'cursor-progress', look, FOCUS, extra]}
    onclick={click}
  >
    {#if busy && busyText}{busyText}{:else}{@render children()}{/if}
  </button>
{/if}
