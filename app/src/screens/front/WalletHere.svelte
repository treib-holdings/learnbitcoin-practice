<script lang="ts">
  // The wallet that is in this browser: which one it is, and the way into it.
  //
  // Home shows it first when a wallet is here. Create and Restore show it
  // in their own place (`already`): one browser keeps one practice wallet,
  // so neither can put another one here, and the ways on are to open this
  // one or to remove it under Settings. With `arrived`, the wallet came from
  // another tab while a tap on this page was being answered, and the piece
  // says so first, as an alert.
  //
  // A wallet made with a passkey is pointed out by the four characters in
  // its passkey's name, which is all of the name that this browser keeps. A
  // wallet made without a passkey says so. The piece draws nothing unless a
  // wallet is here.
  //
  // The way in leads to the overview. For a wallet made on this page whose
  // "Wallet made" step has not been seen yet, it leads to that step: a
  // passkey prompt can outlive the visit to Create that opened it, and the
  // 12 words are then still to be shown (wayIn in flow.ts).

  import type { Snippet } from 'svelte';
  import Actions from '../../components/Actions.svelte';
  import Button from '../../components/Button.svelte';
  import Card from '../../components/Card.svelte';
  import Notice from '../../components/Notice.svelte';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { walletLine, wayIn } from './flow.ts';

  interface Props {
    /** On Create and Restore: the reader came to put a wallet here, and one is here already. */
    already?: boolean;
    /** The wallet arrived from another tab while a tap on this page was being answered. */
    arrived?: boolean;
    /** What the screen adds under the piece's own lines. */
    children?: Snippet;
  }

  let { already = false, arrived = false, children }: Props = $props();

  const wallet = useWallet();

  let t = $derived(strings.home[router.lang]);
  let c = $derived(strings.common[router.lang]);

  let record = $derived(wallet.record);
  let which = $derived.by(() => {
    if (record === null) return '';
    const line = walletLine(record);
    return line.key === 'herePasskeyTagged' ? fill(t.herePasskeyTagged, { tag: line.tag }) : t[line.key];
  });
</script>

{#if record !== null}
  <Card title={already ? t.hereAlready : t.hereTitle} data-testid="wallet-here">
    <div class="space-y-4">
      {#if arrived}
        <Notice kind="problem" text={t.hereArrived} data-testid="front-stop" />
      {/if}
      <div class="space-y-3 text-pretty leading-relaxed text-ink-700">
        <p data-testid="wallet-here-kind">{which}</p>
        {#if already}<p>{t.hereOne}</p>{/if}
        {@render children?.()}
      </div>
      <!-- One group: on a phone both buttons take the whole width, so the short one is not a stub beside the long one. -->
      <Actions>
        <Button
          variant="primary"
          class="w-full sm:w-auto"
          data-testid="wallet-open"
          href={router.link({ name: wayIn(wallet.created) })}
        >
          {t.hereOpen}
        </Button>
        {#if already}
          <Button class="w-full sm:w-auto" href={router.link({ name: 'settings' })}>{c.section_settings}</Button>
        {/if}
      </Actions>
    </div>
  </Card>
{/if}
