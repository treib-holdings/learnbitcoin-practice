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

  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import { SAFARI_KEEPS_DAYS } from './frame.ts';
  import OpenWithPasskey from './OpenWithPasskey.svelte';

  interface Props {
    /** Called once a wallet has been opened with a passkey. A wallet screen needs none. */
    onopened?: () => void;
    class?: string;
  }

  let { onopened, class: extra = '' }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
  let why = $derived(fill(t.gateNoneWhy, { days: String(SAFARI_KEEPS_DAYS) }));
</script>

<div class={['space-y-6', extra]}>
  <p class="text-pretty leading-relaxed text-ink-700">{why}</p>
  <div class="space-y-4">
    <OpenWithPasskey {onopened} buttonClass="w-full sm:w-auto" />
    <Actions>
      <Button class="w-full sm:w-auto" href={router.link({ name: 'restore' })}>{t.gateRestore}</Button>
      <Button class="w-full sm:w-auto" href={router.link({ name: 'new' })}>{t.gateCreate}</Button>
    </Actions>
  </div>
</div>
