<script module lang="ts">
  /** What the control inside a field must carry. Spread it onto the control. */
  export interface FieldAttributes {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': 'true' | undefined;
  }
</script>

<script lang="ts">
  // A field with its label, its hint and its error, wired for a screen reader.
  //
  // The order is the one the main site's reviewed form uses: the label, then
  // what the reader should know before typing (the hint), then the control,
  // then what is wrong with what was typed (the error). The control names
  // the hint and the error in aria-describedby and carries aria-invalid
  // while there is an error.
  //
  // The control goes inside, and takes its attributes from the snippet:
  //
  //   <Field label="Address" hint="Starts with bcrt1." error={problem}>
  //     {#snippet children(field)}
  //       <TextInput {...field} bind:value={address} mono />
  //     {/snippet}
  //   </Field>

  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** What to know before typing. Shown above the control. */
    hint?: string;
    /** What is wrong with what was typed: the cause, then the way out. Empty: nothing is wrong. */
    error?: string;
    class?: string;
    children: Snippet<[FieldAttributes]>;
  }

  let { label, hint = '', error = '', class: extra = '', children }: Props = $props();

  // Unique to this field, so two fields on one screen never share an id.
  const id = $props.id();

  let describedBy = $derived(
    [hint !== '' ? `${id}-hint` : '', error !== '' ? `${id}-error` : ''].filter((part) => part !== '').join(' '),
  );
  let attributes = $derived<FieldAttributes>({
    id: `${id}-control`,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    'aria-invalid': error !== '' ? 'true' : undefined,
  });
</script>

<div class={['flex flex-col gap-1', extra]}>
  <label for="{id}-control" class="block text-sm font-semibold text-ink-800">{label}</label>
  {#if hint !== ''}
    <p id="{id}-hint" class="text-pretty text-sm leading-relaxed text-ink-500">{hint}</p>
  {/if}
  {@render children(attributes)}
  {#if error !== ''}
    <p id="{id}-error" class="text-pretty text-sm font-semibold leading-relaxed text-ink-800">{error}</p>
  {/if}
</div>
