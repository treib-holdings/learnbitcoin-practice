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
  //
  // An error is one sentence. What belongs to it and is more than that (a
  // second paragraph, a button that puts it right, a link) goes in the
  // `after` snippet. It is drawn under the sentence, inside the element the
  // control names as its description, so a screen reader hears it with the
  // error and the caller wires nothing by hand. It shows only while there
  // is an error: a note that stands without one is the screen's own.

  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** What to know before typing. Shown above the control. */
    hint?: string;
    /** What is wrong with what was typed: the cause, then the way out. Empty: nothing is wrong. */
    error?: string;
    /** More that belongs to the error, drawn under it and read out with it. Not drawn while there is no error. */
    after?: Snippet;
    class?: string;
    children: Snippet<[FieldAttributes]>;
  }

  let { label, hint = '', error = '', after, class: extra = '', children }: Props = $props();

  const ERROR = 'text-pretty text-sm font-semibold leading-relaxed text-ink-800';

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
    {#if after}
      <!-- The whole of it is the control's description: the sentence and what the caller hangs under it. -->
      <div id="{id}-error" class="flex flex-col gap-2">
        <p class={ERROR}>{error}</p>
        {@render after()}
      </div>
    {:else}
      <p id="{id}-error" class={ERROR}>{error}</p>
    {/if}
  {/if}
</div>
