<script lang="ts">
  // What "Choose another passkey" came to, in words, for the answers that
  // open no question and leave the wallet as it was (read.ts, afterChoose):
  //
  //   same     the reader chose the passkey this browser already holds
  //   passkey  the passkey step did not finish: the sentence from the error
  //            table, as Create, Open and Unlock show it
  //   changed  the stored passkey gave a wallet that fits nothing saved
  //            here. The same four short parts as on the unlock step: what
  //            happened, the warning by itself, and each of the two ways out
  //   gone     the wallet was removed or replaced in another tab
  //
  // It stands in two places. In the list of causes, right above the button
  // that was pressed (read/OpenedEmpty.svelte). And at the top of the
  // Overview, for the two answers that arrive after that list has left the
  // screen (Overview.svelte says when that is).
  //
  // The warning carries the hook the unlock step gives the same sentence,
  // so that a test finds it wherever it is shown.

  import Notice from '../../components/Notice.svelte';
  import TextLink from '../../components/TextLink.svelte';
  import PasskeyProblem from '../../components/wallet/PasskeyProblem.svelte';
  import ReloadButton from '../../components/wallet/ReloadButton.svelte';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import type { ChooseTold } from './read.ts';

  interface Props {
    outcome: ChooseTold;
  }

  let { outcome }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);
</script>

{#if outcome.show === 'same'}
  <Notice kind="problem" text={t.emptyOtherSame} data-testid="opened-same" />
{:else if outcome.show === 'passkey'}
  <PasskeyProblem failure={outcome.failure} data-testid="opened-problem" />
{:else if outcome.show === 'changed'}
  <Notice kind="problem" text={t.unlockChanged} data-testid="opened-problem">
    <div class="space-y-2">
      <p class="font-semibold text-ink-800" data-testid="unlock-changed-warning">{t.unlockChangedWarn}</p>
      <p>{t.unlockChangedWords}</p>
      <p>{t.unlockChangedRemove}</p>
      <p><TextLink href={router.link({ name: 'settings' })}>{c.section_settings}</TextLink></p>
    </div>
  </Notice>
{:else}
  <Notice kind="problem" text={t.unlockGone} data-testid="opened-problem">
    <ReloadButton />
  </Notice>
{/if}
