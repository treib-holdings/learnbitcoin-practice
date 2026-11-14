<script lang="ts">
  // What a reader is offered when this browser has no practice wallet
  // (SPEC section 3, "No record"): why that may be, and then, in this
  // order, open with my passkey, restore from the 12 words, create.
  //
  // It is the body of the gate that stands in for a wallet screen, whose
  // heading says "This browser has no practice wallet." Home shows the same
  // three ways in: with `grouped`, the first two sit together in a panel
  // headed "I already have a practice wallet", and Create becomes the
  // screen's main button.

  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import Card from '../Card.svelte';
  import { SAFARI_KEEPS_DAYS } from './frame.ts';
  import OpenWithPasskey from './OpenWithPasskey.svelte';

  interface Props {
    /** Home's layout: the first two ways in share a panel with its own heading. */
    grouped?: boolean;
    /** Called once a wallet has been opened with a passkey. A wallet screen needs none. */
    onopened?: () => void;
    class?: string;
  }

  let { grouped = false, onopened, class: extra = '' }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
  let why = $derived(fill(t.gateNoneWhy, { days: String(SAFARI_KEEPS_DAYS) }));
</script>

{#if grouped}
  <div class={['space-y-6', extra]}>
    <Card tone="grey" title={t.gateAlreadyHave}>
      <div class="space-y-4">
        <p class="text-pretty text-sm leading-relaxed text-ink-600">{why}</p>
        <OpenWithPasskey variant="secondary" {onopened} />
        <div><Button href={router.link({ name: 'restore' })}>{t.gateRestore}</Button></div>
      </div>
    </Card>
    <div><Button variant="primary" href={router.link({ name: 'new' })}>{t.gateCreate}</Button></div>
  </div>
{:else}
  <div class={['space-y-6', extra]}>
    <p class="text-pretty leading-relaxed text-ink-700">{why}</p>
    <div class="space-y-4">
      <OpenWithPasskey {onopened} />
      <Actions>
        <Button href={router.link({ name: 'restore' })}>{t.gateRestore}</Button>
        <Button href={router.link({ name: 'new' })}>{t.gateCreate}</Button>
      </Actions>
    </div>
  </div>
{/if}
