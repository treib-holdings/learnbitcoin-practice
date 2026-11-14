<script lang="ts">
  // The two things that tell one practice wallet from another: the four
  // characters in the name its passkey is saved under, and its wallet
  // fingerprint, with the one line that says what a wallet fingerprint is.
  // It is never written as a bare "fingerprint": a reader would take that
  // for the fingerprint their phone asks for.
  //
  // The passkey's whole name is not shown, because it is not known: it was
  // written in the language of the page the passkey was made on, and this
  // browser keeps only the tag. A name made up from the tag in the language
  // of this page could be one the reader's password manager does not list.
  //
  // The unlock step shows it before a switch to another passkey's wallet,
  // and the frame shows it after one.

  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Mono from '../Mono.svelte';
  import Row from '../Row.svelte';
  import Rows from '../Rows.svelte';

  interface Props {
    /** The tag in the passkey's name, or null when it is not known. */
    tag: string | null;
    /** The wallet fingerprint: 8 hex characters. */
    fingerprint: string;
    class?: string;
  }

  let { tag, fingerprint, class: extra = '' }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
</script>

<div class={extra}>
  <Rows>
    <Row name={t.switchPasskey}>
      {tag !== null ? fill(t.switchPasskeyTagged, { tag }) : t.switchPasskeyUnknown}
    </Row>
    <Row name={t.walletFingerprint}><Mono value={fingerprint} /></Row>
  </Rows>
  <p class="mt-2 text-sm text-ink-500">{t.walletFingerprintIs}</p>
</div>
