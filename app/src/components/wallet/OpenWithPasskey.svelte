<script lang="ts">
  // "Open with my passkey": for a browser that has no practice wallet. The
  // reader picks one of their practice passkeys and its wallet is put in
  // this browser, unlocked.
  //
  // The piece is the button and everything the wallet can answer. Where
  // this browser gives the page no passkeys, it says so in the button's
  // place and points to the device's own browser. While that is still being
  // found out, the button waits, switched off. While the passkey prompt is
  // open, <main> is marked busy (busyWhile).
  //
  // When the wallet has been opened, `onopened` is called. On a wallet
  // screen nothing more is needed: the gate that showed this piece gives way
  // to the screen by itself. Home passes a function that goes to the
  // overview.

  import { router } from '../../lib/router.svelte.ts';
  import type { OpenResult } from '../../lib/wallet-api.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Button from '../Button.svelte';
  import Notice from '../Notice.svelte';
  import { busyWhile } from '../status.svelte.ts';
  import PasskeyProblem from './PasskeyProblem.svelte';
  import ReloadButton from './ReloadButton.svelte';

  interface Props {
    /** The button's weight: the gate's first choice, or one way among others on Home. */
    variant?: 'primary' | 'secondary';
    /** Called once the wallet is in this browser. Its first scan has started. */
    onopened?: () => void;
    class?: string;
  }

  let { variant = 'primary', onopened, class: extra = '' }: Props = $props();

  const wallet = useWallet();

  let t = $derived(strings.wallet[router.lang]);

  /** The passkey prompt is open. */
  let busy = $state(false);
  /** How the last try ended, unless it opened a wallet. */
  let answer = $state.raw<Exclude<OpenResult, { kind: 'opened' }> | null>(null);

  async function open(): Promise<void> {
    if (busy) return;
    // Read now: by the time the wallet answers, the gate may have taken this piece away.
    const opened = onopened;
    busy = true;
    answer = null;
    const result = await busyWhile(wallet.openWithPasskey());
    busy = false;
    if (result.kind === 'opened') opened?.();
    else answer = result;
  }
</script>

<div class={['space-y-4', extra]}>
  {#if wallet.passkeyOffered === false}
    <Notice text={t.openNotOffered} data-testid="open-not-offered" />
  {:else}
    <Button
      {variant}
      data-testid="open-passkey"
      {busy}
      busyText={t.openBusy}
      disabled={wallet.passkeyOffered === null}
      onclick={() => void open()}
    >
      {t.openButton}
    </Button>
  {/if}

  {#if answer !== null}
    {#if answer.kind === 'exists'}
      <Notice kind="problem" text={t.openExists}>
        <ReloadButton />
      </Notice>
    {:else if answer.kind === 'no-storage'}
      <Notice kind="problem" text={t.noStorage} />
    {:else if answer.kind === 'cancelled'}
      <!-- A closed prompt and a device with no practice passkey look the same from here. -->
      <PasskeyProblem failure={answer}>
        <p class="text-sm text-ink-600">{t.openHint}</p>
      </PasskeyProblem>
    {:else}
      <PasskeyProblem failure={answer} />
    {/if}
  {/if}
</div>
