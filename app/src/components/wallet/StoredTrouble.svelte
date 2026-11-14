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
  //
  // For "none" and "ready" it shows nothing. On a wallet screen it is the
  // body of the gate, under the gate's heading. Home passes `titled`, and
  // it comes as a panel with that heading inside.

  import { tick } from 'svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import Card from '../Card.svelte';
  import Notice from '../Notice.svelte';
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
    status === 'unreadable' ? t.unreadableTitle : status === 'newer' ? t.newerTitle : status === 'broken' ? t.brokenTitle : '',
  );

  /** The reader has asked to remove what is stored, and is being asked whether they mean it. */
  let asking = $state(false);
  /** Remove found that what is stored had changed in another tab. */
  let changed = $state(false);

  let root = $state<HTMLElement>();
  let question = $state<HTMLElement>();

  async function ask(): Promise<void> {
    asking = true;
    changed = false;
    await tick();
    // The question is read out, and Tab goes on to its two answers.
    question?.focus();
  }

  async function keep(): Promise<void> {
    asking = false;
    await tick();
    root?.querySelector<HTMLElement>('[data-testid="remove-wallet"]')?.focus();
  }

  async function remove(): Promise<void> {
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
        <ReloadButton variant="primary" />
        <Button data-testid="remove-wallet" aria-expanded={asking} onclick={() => void ask()}>{t.unreadableRemove}</Button>
      </Actions>
      {#if asking}
        <Notice kind="caution">
          <div class="space-y-3">
            <!-- tabindex="-1": it takes focus from code only, so that the question is read out. -->
            <p bind:this={question} tabindex="-1" class="font-semibold text-ink-800 outline-none">{t.unreadableAsk}</p>
            <p>{t.unreadableWarn}</p>
            <!-- Full-size buttons with room between them: one of the two cannot be undone. -->
            <Actions>
              <Button data-testid="remove-confirm" onclick={() => void remove()}>{t.unreadableYes}</Button>
              <Button data-testid="remove-keep" onclick={() => void keep()}>{t.unreadableNo}</Button>
            </Actions>
          </div>
        </Notice>
      {/if}
    {:else if status === 'newer'}
      <p class="text-pretty leading-relaxed text-ink-700">{t.newerBody}</p>
      <div><ReloadButton variant="primary" /></div>
    {:else if status === 'broken'}
      <Notice kind="problem" silent text={errors.passkey_broken} />
    {/if}
  </div>
{/snippet}

{#if status === 'unreadable' || status === 'newer' || status === 'broken'}
  {#if titled}
    <Card {title} class={extra}>
      {@render body()}
    </Card>
  {:else}
    <div class={extra}>{@render body()}</div>
  {/if}
{/if}
