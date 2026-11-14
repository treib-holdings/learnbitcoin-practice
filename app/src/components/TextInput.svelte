<script lang="ts">
  // A one-line text field. Its text is 16 px: under that, Safari on a phone
  // zooms the page when the field takes focus.
  //
  // `mono` is for addresses, amounts and words. Such a field also wants
  // spellcheck="false", autocomplete="off", autocapitalize="none" and
  // translate="no": pass them as attributes. Amounts are whole sats, so use
  // inputmode="numeric" and parseSats (lib/format.ts), not type="number".
  //
  // An error shows as a darker orange edge, and Field puts the sentence under
  // the control: the edge is never the only sign. To move focus here from
  // code (a bad word gets focus), bind the component and call focus():
  //
  //   <TextInput bind:this={field} bind:value={text} />   then   field.focus()

  import type { HTMLInputAttributes } from 'svelte/elements';
  import { FIELD } from './styles.ts';

  interface Props extends Omit<HTMLInputAttributes, 'class' | 'value' | 'type'> {
    /** Two-way: write bind:value. */
    value?: string;
    mono?: boolean;
    class?: string;
  }

  let { value = $bindable(''), mono = false, class: extra = '', ...rest }: Props = $props();

  let element = $state<HTMLInputElement>();

  // The edge of a field whose value is refused: darker orange, and a hair
  // thicker. Drawn as a ring, so the field does not change size.
  const INVALID = 'aria-invalid:border-orange-600 aria-invalid:ring-1 aria-invalid:ring-orange-600';

  /** Moves keyboard focus into the field. */
  export function focus(): void {
    element?.focus();
  }
</script>

<input
  {...rest}
  bind:this={element}
  bind:value
  type="text"
  class={[FIELD, INVALID, mono && 'font-mono', extra]}
/>
