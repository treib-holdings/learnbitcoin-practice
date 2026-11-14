<script lang="ts">
  // Twelve numbered fields for typing the 12 words: on the Restore screen,
  // and where a passkey wallet is unlocked with its words.
  //
  // The words live in these fields and nowhere else. The piece hands them
  // over once, when the caller asks:
  //
  //   <WordsInput bind:this={input} data-testid="restore-words" onenter={go} />
  //
  //   const words = input.check();   // null: something is wrong, and the piece says what
  //   if (words !== null) await wallet.restore(words);
  //
  // Pass the answer straight to the wallet. Do not keep it in a variable
  // that outlives the call, and never in $state. When the piece is taken
  // off the screen it empties its fields.
  //
  // What it does for the reader:
  //   - a pasted phrase is spread across the fields, one word each, and a
  //     space typed after a word moves on to the next field;
  //   - each word is checked against the list as it is typed
  //     (wallet.checkWords). A field left holding a word that is not on the
  //     list is marked, and a line under the fields names it. The field
  //     points at that line (aria-describedby), so a screen reader reads it
  //     when focus comes to the field;
  //   - check() marks every wrong or empty field and moves focus to the
  //     first of them;
  //   - Enter moves on to the next field, and in the last one calls `onenter`.
  //
  // Every field carries the attributes SPEC section 12 asks of a field for
  // seed words: no spell check, no autocomplete, no autocorrect, no
  // capitals, never translated, no name, and no form around it. So no
  // browser offers to remember or to "fix" a word. On a Spanish screen a
  // line above the fields says the words are English on purpose.
  //
  // On paper the fields are left out: the words are written by hand
  // (the print rule in app.css).

  import { tick } from 'svelte';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Notice from '../Notice.svelte';
  import TextInput from '../TextInput.svelte';
  import { WORD_COUNT, checkFields, placeWords, splitWords } from './words.ts';

  interface Props {
    /** What a screen reader calls the twelve fields together. Without it: "The 12 words". */
    label?: string;
    /** The fields take no typing: the caller is busy with the words it was given. */
    disabled?: boolean;
    /** Enter was pressed in the last field. */
    onenter?: () => void;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { label, disabled = false, onenter, class: extra = '', ...rest }: Props = $props();

  const wallet = useWallet();
  const id = $props.id();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);

  /** What each field holds. This is the only place the words are kept. */
  let fields = $state<string[]>(Array.from({ length: WORD_COUNT }, () => ''));
  /** The reader has left this field, or has asked for the check: its word may now be called wrong. */
  let judged = $state<boolean[]>(Array.from({ length: WORD_COUNT }, () => false));
  /** The check found empty fields. */
  let asked = $state(false);
  /** The check found twelve words that are on the list and do not pass their checksum. */
  let failed = $state(false);

  /** Asked on every keystroke: the wallet's check is cheap, and it keeps nothing. */
  let found = $derived(checkFields(fields, (text) => wallet.checkWords(text)));
  /** The fields that show as wrong: a word that is not on the list, once the reader has moved on from it. */
  let wrong = $derived(fields.map((_, index) => judged[index] === true && found.unknown.includes(index)));
  let missing = $derived(asked && found.empty.length > 0);

  let root = $state<HTMLElement>();

  function field(index: number): HTMLInputElement | undefined {
    return root?.querySelectorAll('input')[index];
  }

  /** Puts words into the fields from `index` on, and moves focus to where the reader goes on. */
  async function place(index: number, words: string[]): Promise<void> {
    const placed = placeWords(fields, index, words);
    // A word that was just put into a field is finished: it may be called wrong at once.
    placed.fields.forEach((word, at) => {
      if (word !== '' && word !== fields[at]) judged[at] = true;
    });
    fields = placed.fields;
    await tick();
    field(placed.next)?.focus();
  }

  /** Something was typed into field `index`. */
  function typed(index: number): void {
    failed = false;
    const value = fields[index] ?? '';
    // A space ends a word. Whatever the field now holds (one word and a
    // space, or several words from a keyboard that suggests them) is spread
    // from this field on.
    if (/\s/.test(value)) void place(index, splitWords(value));
  }

  function pasted(event: ClipboardEvent, index: number): void {
    const words = splitWords(event.clipboardData?.getData('text') ?? '');
    // One word is pasted into the field as usual.
    if (words.length < 2) return;
    event.preventDefault();
    failed = false;
    void place(index, words);
  }

  function key(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (index < WORD_COUNT - 1) field(index + 1)?.focus();
    else onenter?.();
  }

  function left(index: number): void {
    judged[index] = (fields[index] ?? '').trim() !== '';
  }

  /**
   * The words, as one text, when they are twelve words on the list that
   * pass their checksum. Otherwise null: the piece then marks what is
   * wrong, says so under the fields, and moves focus to the first wrong or
   * empty field.
   */
  export function check(): string | null {
    judged = judged.map(() => true);
    const now = checkFields(fields, (text) => wallet.checkWords(text));
    if (now.valid) {
      asked = false;
      failed = false;
      return now.text;
    }
    asked = true;
    failed = now.unknown.length === 0 && now.empty.length === 0;
    const first = now.unknown[0] ?? now.empty[0];
    if (first !== undefined) void tick().then(() => field(first)?.focus());
    return null;
  }

  /** Empties every field. */
  export function clear(): void {
    fields = fields.map(() => '');
    judged = judged.map(() => false);
    asked = false;
    failed = false;
  }

  /** Moves keyboard focus to the first field. */
  export function focus(): void {
    field(0)?.focus();
  }

  /** When the piece leaves the screen, its fields are emptied: the words do not outlive it. */
  function emptied(node: HTMLElement): () => void {
    return () => {
      for (const input of node.querySelectorAll('input')) input.value = '';
      fields = [];
    };
  }

  /** What field `index` is described by, when something is wrong with it. */
  function describedBy(index: number): string | undefined {
    if (wrong[index]) return `${id}-word-${index}`;
    if (missing && found.empty.includes(index)) return `${id}-missing`;
    return undefined;
  }

  const ERROR = 'text-pretty text-sm font-semibold leading-relaxed text-ink-800';
</script>

<div
  {...rest}
  {@attach emptied}
  bind:this={root}
  role="group"
  aria-label={label ?? t.wordsGroup}
  data-print="never"
  class={['space-y-3', extra]}
>
  {#if lang === 'es'}
    <p class="text-pretty text-sm leading-relaxed text-ink-500">{t.wordsEnglishType}</p>
  {/if}

  <!-- As many columns as fit, each wide enough that a field, beside its
       number, shows the longest word on the list (eight letters) whole: two
       on a phone, one inside a card on the narrowest phone. A wider screen
       gets three, then four. -->
  <div class="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3 gap-y-2 sm:grid-cols-3 md:grid-cols-4">
    {#each { length: WORD_COUNT }, index}
      <div class="flex items-center gap-1.5">
        <!-- The number is what shows. A screen reader says "Word 7". -->
        <label for="{id}-field-{index}" class="w-4 shrink-0 text-right text-xs tabular-nums text-ink-500">
          <span class="sr-only">{fill(t.wordsNumber, { n: String(index + 1) })}</span>
          <span aria-hidden="true">{index + 1}</span>
        </label>
        <TextInput
          id="{id}-field-{index}"
          bind:value={fields[index]}
          mono
          class="min-w-0"
          data-testid="word-input"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="none"
          translate="no"
          inputmode="text"
          enterkeyhint={index < WORD_COUNT - 1 ? 'next' : 'done'}
          {disabled}
          aria-invalid={wrong[index] || (missing && found.empty.includes(index)) ? 'true' : undefined}
          aria-describedby={describedBy(index)}
          oninput={() => typed(index)}
          onpaste={(event) => pasted(event, index)}
          onkeydown={(event) => key(event, index)}
          onblur={() => left(index)}
        />
      </div>
    {/each}
  </div>

  {#each wrong as isWrong, index (index)}
    {#if isWrong}
      <p id="{id}-word-{index}" class={ERROR}>{fill(t.wordsUnknown, { n: String(index + 1) })}</p>
    {/if}
  {/each}
  {#if missing}
    <p id="{id}-missing" class={ERROR}>{t.wordsMissing}</p>
  {/if}
  {#if failed}
    <Notice kind="problem" text={t.wordsInvalid} data-testid="words-invalid" />
  {/if}
</div>
