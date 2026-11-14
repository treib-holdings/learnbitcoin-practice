<script lang="ts">
  // What is said when a passkey step did not finish, for every way it can
  // fail (CeremonyFailure in lib/wallet-api.ts). Create, Open and Unlock all
  // meet the same failures, so all three show this piece.
  //
  // The sentence comes from the error table (passkey_<kind>): the cause,
  // then the way out. Beside it:
  //   - a prompt that ran out of time says so, in place of "was closed";
  //   - a passkey that answered without its secret is pointed out, when
  //     known, by the four characters in its name. Never by a whole name
  //     made up here: the name was written in the language of the page the
  //     passkey was made on, and this browser keeps only the tag;
  //   - the browser's own error name sits in a folded details line, and
  //     nowhere else;
  //   - "reload" comes with the button that reloads the page.
  // What the screen offers next (try again, another passkey, the 12 words)
  // goes between the tags.

  import type { Snippet } from 'svelte';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import type { CeremonyFailure } from '../../lib/wallet-api.ts';
  import { strings } from '../../strings/index.ts';
  import Details from '../Details.svelte';
  import Mono from '../Mono.svelte';
  import Notice from '../Notice.svelte';
  import ReloadButton from './ReloadButton.svelte';

  interface Props {
    failure: CeremonyFailure;
    class?: string;
    children?: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { failure, class: extra = '', children, ...rest }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
  let errors = $derived(strings.errors[router.lang]);

  let text = $derived(
    failure.kind === 'cancelled' && failure.timedOut ? t.passkeyTimedOut : errors[`passkey_${failure.kind}`],
  );
  /** Which passkey answered, when the wallet could tell: the tag in its name. */
  let named = $derived(
    failure.kind === 'no-prf' && failure.tag !== null ? fill(t.passkeyNamed, { tag: failure.tag }) : null,
  );
  let more = $derived(named !== null || failure.kind === 'error' || failure.kind === 'reload' || children !== undefined);
</script>

<!-- What comes after the sentence. It is handed over only when there is
     something in it, so that a bare sentence gets no empty space under it. -->
{#snippet after()}
  <div class="space-y-3">
    {#if named !== null}
      <p class="text-sm text-ink-600" data-testid="passkey-named">{named}</p>
    {/if}
    {#if failure.kind === 'error'}
      <Details summary={t.passkeyDetail}>
        <Mono value={failure.name} />
      </Details>
    {/if}
    {#if failure.kind === 'reload'}
      <ReloadButton />
    {/if}
    {@render children?.()}
  </div>
{/snippet}

<Notice {...rest} kind="problem" {text} class={extra} children={more ? after : undefined} />
