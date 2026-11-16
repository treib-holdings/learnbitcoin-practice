<script lang="ts">
  // What shows in a wallet's place when this browser cannot use what it has
  // stored (SPEC section 3), chosen by the wallet's status:
  //
  //   unreadable  something is stored and cannot be read. Nothing is
  //               overwritten: the reader may reload, or remove it. Remove
  //               asks first.
  //   newer       it was written by a newer version of this page: "This
  //               page is out of date." Reload only; nothing is removed.
  //   broken      the self-test failed: nothing can be made or opened in
  //               this browser, and the way out is another browser.
  //   blocked     the browser did not let this page read its storage, so
  //               nobody knows whether a wallet is here: one made before
  //               may still be stored. It never says "no wallet". The way
  //               out is to allow site data for the page, and Reload.
  //
  // For "none" and "ready" it shows nothing. On a wallet screen it is the
  // body of the gate, under the gate's heading. Home passes `titled`, and
  // it comes as a panel with that heading inside.
  //
  // The question before Remove is the only guard Remove has, so it must be
  // seen before it can be answered. Opening it moves the page no further
  // than it takes to bring the whole question on screen, both answers
  // included, and neither answer takes a press in the first moment after it
  // opened (components/taps.ts): the second tap of a double tap on the
  // Remove button removes nothing, and leaves the question standing.
  //
  // On a phone the buttons of a group stand one under the other, each as
  // wide as the panel, so that a short label is not a narrow button under
  // a wide one.

  import { tick } from 'svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import Card from '../Card.svelte';
  import Notice from '../Notice.svelte';
  import { answerCounts } from '../taps.ts';
  import ReloadButton from './ReloadButton.svelte';

  interface Props {
    /** A panel with the state's heading inside, for a screen that has a heading of its own. */
    titled?: boolean;
    class?: string;
  }

  let { titled = false, class: extra = '' }: Props = $props();

  const wallet = useWallet();

  let t = $derived(strings.wallet[router.lang]);
  let errors = $derived(strings.errors[router.lang]);

  let status = $derived(wallet.status);
  let title = $derived(
    status === 'unreadable'
      ? t.unreadableTitle
      : status === 'newer'
        ? t.newerTitle
        : status === 'broken'
          ? t.brokenTitle
          : status === 'blocked'
            ? t.blockedTitle
            : '',
  );

  /** The reader has asked to remove what is stored, and is being asked whether they mean it. */
  let asking = $state(false);
  /** Remove found that what is stored had changed in another tab. */
  let changed = $state(false);
  /** When the question opened, on the page's own clock (performance.now()), in ms. */
  let askedAt = 0;

  let root = $state<HTMLElement>();
  /** The whole question: the sentence, the warning, and the two answers. */
  let box = $state<HTMLElement>();
  let question = $state<HTMLElement>();

  async function ask(): Promise<void> {
    asking = true;
    changed = false;
    askedAt = performance.now();
    await tick();
    // The question is read out, and Tab goes on to its two answers. Focus
    // by itself must not move the page: a browser brings what takes focus
    // to the middle of the screen, which can put "Remove it" under the
    // finger that has just pressed the button and leave "Keep it" below the
    // screen's edge. The whole question is brought on screen instead, by
    // the shortest way, and nothing moves when it is there already.
    question?.focus({ preventScroll: true });
    box?.scrollIntoView({ block: 'nearest' });
  }

  /** True for a press on an answer that came too soon to count: the question has only just opened. */
  function tooSoon(event: MouseEvent): boolean {
    return !answerCounts(performance.now() - askedAt, event);
  }

  async function keep(event: MouseEvent): Promise<void> {
    if (tooSoon(event)) return;
    asking = false;
    await tick();
    root?.querySelector<HTMLElement>('[data-testid="remove-wallet"]')?.focus();
  }

  async function remove(event: MouseEvent): Promise<void> {
    // The question has only just opened, or this is the second click of a
    // double tap: the reader cannot have read it yet. Nothing happens, and
    // the question stays.
    if (tooSoon(event)) return;
    // "removed": the status is now "none", and this piece gives way to the
    // three ways into a wallet. The button that was pressed is gone with
    // it, so focus goes to the screen's heading.
    if (wallet.removeWallet() === 'removed') {
      await tick();
      focusHeading();
      return;
    }
    // "gone": another tab changed what is stored, and nothing was removed.
    asking = false;
    changed = true;
    await tick();
    root?.querySelector<HTMLElement>('[data-testid="remove-wallet"]')?.focus();
  }
</script>

{#snippet body()}
  <div bind:this={root} class="space-y-6">
    {#if status === 'unreadable'}
      <div class="space-y-4 text-pretty leading-relaxed text-ink-700">
        <p>{t.unreadableBody}</p>
        <p>{t.unreadableWay}</p>
      </div>
      {#if changed}
        <Notice kind="problem" text={t.unreadableGone} />
      {/if}
      <Actions>
        <ReloadButton variant="primary" class="w-full sm:w-auto" />
        <Button class="w-full sm:w-auto" data-testid="remove-wallet" aria-expanded={asking} onclick={() => void ask()}>
          {t.unreadableRemove}
        </Button>
      </Actions>
      {#if asking}
        <div bind:this={box}>
          <Notice kind="caution">
            <div class="space-y-3">
              <!-- tabindex="-1": it takes focus from code only, so that the question is read out. -->
              <p bind:this={question} tabindex="-1" class="font-semibold text-ink-800 outline-none">{t.unreadableAsk}</p>
              <p>{t.unreadableWarn}</p>
              <!-- Full-size buttons of one width on a phone, with room between them: one of the two cannot be undone. -->
              <Actions>
                <Button class="w-full sm:w-auto" data-testid="remove-confirm" onclick={(event) => void remove(event)}>
                  {t.unreadableYes}
                </Button>
                <Button class="w-full sm:w-auto" data-testid="remove-keep" onclick={(event) => void keep(event)}>
                  {t.unreadableNo}
                </Button>
              </Actions>
            </div>
          </Notice>
        </div>
      {/if}
    {:else if status === 'newer'}
      <p class="text-pretty leading-relaxed text-ink-700">{t.newerBody}</p>
      <div><ReloadButton variant="primary" /></div>
    {:else if status === 'broken'}
      <Notice kind="problem" silent text={errors.passkey_broken} />
    {:else if status === 'blocked'}
      <!-- Not known, and said so: what the browser did, that a wallet made before may still be stored, and the way out. -->
      <div class="space-y-4 text-pretty leading-relaxed text-ink-700" data-testid="storage-blocked">
        <p>{t.blockedBody}</p>
        <p>{t.blockedWay}</p>
      </div>
      <div><ReloadButton variant="primary" /></div>
    {/if}
  </div>
{/snippet}

{#if status === 'unreadable' || status === 'newer' || status === 'broken' || status === 'blocked'}
  {#if titled}
    <Card {title} class={extra}>
      {@render body()}
    </Card>
  {:else}
    <div class={extra}>{@render body()}</div>
  {/if}
{/if}
