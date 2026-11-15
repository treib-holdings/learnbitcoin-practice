<script lang="ts">
  // The question before a switch: another passkey has answered, and the
  // reader is asked whether this browser should hold that passkey's wallet
  // from now on. Nothing has changed when it is asked, and nothing changes
  // unless the reader says so.
  //
  //   <SwitchQuestion {pending} onswitch={...} onkeep={...} />
  //
  // Draw it while wallet.pendingSwitch is set, and hand that value in as
  // `pending`. It shows what tells the two wallets apart (the tag in the
  // other passkey's name, and that wallet's fingerprint) and two answers of
  // equal weight: "Switch" and "Keep". The piece asks and no more: what each
  // answer does is the caller's (`onswitch` calls wallet.confirmSwitch(),
  // `onkeep` calls wallet.cancelSwitch()), because what happens next
  // differs: the unlock step goes on to load the keys, the Overview stays
  // where it is.
  //
  // Two places ask it. The unlock step, when the passkey the reader used is
  // not this wallet's. And the Overview of a wallet that was opened and
  // turned out empty, where the reader chooses another passkey without
  // locking the one they have.
  //
  // When the reader says "Switch" and the browser will not store the
  // change, the wallet keeps the offer and the question stays. Pass
  // `refused` then: the reason stands right above the two answers, where
  // the reader is looking, and is read out.
  //
  // The question itself (data-testid "switch-question") takes focus from
  // code only: move focus to it when it appears, so that it is read out
  // and Tab goes on to its answers.

  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import Notice from '../Notice.svelte';
  import { splitLead } from '../text.ts';
  import WalletId from './WalletId.svelte';

  interface Props {
    /** The other passkey's wallet, as wallet.pendingSwitch has it. */
    pending: { tag: string | null; fingerprint: string };
    /** The reader said "Switch" and the browser would not store the change. */
    refused?: boolean;
    /**
     * The test hook of the sentence that says so. A caller whose tests know
     * that sentence by a name of their own passes the name.
     */
    refusedHook?: string;
    /** "Switch to that wallet". */
    onswitch: () => void;
    /** "Keep this wallet". */
    onkeep: () => void;
    class?: string;
  }

  let { pending, refused = false, refusedHook = 'switch-refused', onswitch, onkeep, class: extra = '' }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
  /** What happened, in bold, and then that nothing has changed. */
  let asked = $derived(splitLead(t.switchLead));
</script>

<Notice kind="caution" class={extra}>
  <div class="space-y-3">
    <!-- tabindex="-1": it takes focus from code only, so that the question is read out. -->
    <p tabindex="-1" data-testid="switch-question" class="outline-none">
      <span class="font-semibold text-ink-800">{asked.lead}</span>
      {asked.rest}
    </p>
    <WalletId tag={pending.tag} fingerprint={pending.fingerprint} />
    <p>{t.switchAsk}</p>
    {#if refused}
      <p class="font-semibold text-ink-800" role="alert" data-testid={refusedHook}>{t.switchNoStorage}</p>
    {/if}
    <!-- Full-size buttons with room between them: one of the two changes which
         wallet this browser holds. On a phone they stand one under the other,
         each as wide as the box, so that neither looks like the lesser answer. -->
    <Actions>
      <Button class="w-full sm:w-auto" data-testid="switch-confirm" onclick={onswitch}>{t.switchYes}</Button>
      <Button class="w-full sm:w-auto" data-testid="switch-cancel" onclick={onkeep}>{t.switchNo}</Button>
    </Actions>
  </div>
</Notice>
