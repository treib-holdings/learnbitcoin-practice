<script lang="ts">
  // What a reader is offered when this browser has no practice wallet
  // (SPEC section 3, "No record"): why that may be, and then, in this
  // order, open with my passkey, restore from the 12 words, create.
  //
  // It is the body of the gate that stands in for a wallet screen, whose
  // heading says "This browser has no practice wallet." Home shows the same
  // three ways in with a layout of its own (Create first, for a newcomer),
  // built from the same pieces and the same words.
  //
  // On a phone the three ways in stand one under the other, and get one
  // width, the whole column: three buttons of three widths read as three
  // unrelated things.
  //
  // One reader with no wallet is not here to choose among the three: the
  // reader in the middle of the drill of "Prove the backup", whose wallet
  // was removed for it and has to come back from the 12 words. They reach a
  // gate by the browser's Back from Home, or by coming back to the wallet
  // at an address of one of its screens. Home puts the restore first for
  // them, and so does the gate, by Home's own rule and in Home's own words:
  // for as long as the note of the "Do it" steps follows that step and it
  // waits for its wallet (awaitsRestore in screens/doit/view.ts), "Restore
  // from the 12 words" stands first, as the main button, with the sentence
  // under it that names the step. "Open with my passkey" is then a second
  // button: for a wallet made with a passkey it is the way the step itself
  // warns against, since it proves the passkey and not the paper. Every
  // other reader sees the gate as it always was.

  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { awaitsRestore } from '../../screens/doit/view.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import { stepTitle } from '../doit/strip.ts';
  import { SAFARI_KEEPS_DAYS } from './frame.ts';
  import OpenWithPasskey from './OpenWithPasskey.svelte';

  interface Props {
    /** Called once a wallet has been opened with a passkey. A wallet screen needs none. */
    onopened?: () => void;
    class?: string;
  }

  let { onopened, class: extra = '' }: Props = $props();

  /** The "Do it" steps: only to know whether the note follows the drill, with its wallet out of the browser. */
  const doit = useDoit();
  /** For the id that ties the sentence under the restore to its button. */
  const uid = $props.id();

  let t = $derived(strings.wallet[router.lang]);
  let d = $derived(strings.doit[router.lang]);
  let why = $derived(fill(t.gateNoneWhy, { days: String(SAFARI_KEEPS_DAYS) }));

  /**
   * The step the note of the "Do it" steps follows, when its open part waits for a removed wallet to come back
   * from the 12 words: the drill of "Prove the backup", between its removal and its restore. Otherwise null.
   * The same rule as Home's (Home.svelte): the note's followed step, with no limit of time, worked out again
   * whenever the note or the wallet changes. No clock is kept for it.
   */
  let restoring = $derived.by(() => {
    const step = doit.progress.following;
    return step !== null && awaitsRestore(doit.view(step, Date.now())) ? step : null;
  });
</script>

<div class={['space-y-6', extra]}>
  {#if restoring !== null}
    <!-- In the middle of the drill: the wallet was removed for the step, and the step goes on with a restore.
         First under the gate's heading: the restore as the main button, and under it the sentence that says
         which step it is for. The button names that sentence as its description. -->
    <div class="space-y-3" data-testid="gate-step">
      <div>
        <Button
          variant="primary"
          class="w-full sm:w-auto"
          data-testid="gate-step-restore"
          aria-describedby="{uid}-step"
          href={router.link({ name: 'restore' })}
        >
          {t.gateRestore}
        </Button>
      </div>
      <p id="{uid}-step" class="text-pretty text-base leading-relaxed text-ink-700">{fill(d.homeRestore, { step: stepTitle(restoring, router.lang) })}</p>
    </div>
  {/if}
  <p class="text-pretty leading-relaxed text-ink-700">{why}</p>
  <div class="space-y-4">
    <!-- The gate's first choice, except in the middle of the drill: there the restore above is, and this is a second button. -->
    <OpenWithPasskey variant={restoring === null ? 'primary' : 'secondary'} {onopened} buttonClass="w-full sm:w-auto" />
    <Actions>
      {#if restoring === null}
        <Button class="w-full sm:w-auto" href={router.link({ name: 'restore' })}>{t.gateRestore}</Button>
      {/if}
      <Button class="w-full sm:w-auto" href={router.link({ name: 'new' })}>{t.gateCreate}</Button>
    </Actions>
  </div>
</div>
