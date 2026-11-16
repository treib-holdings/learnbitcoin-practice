<script lang="ts">
  // A question whose answer is a number: which block took the wallet's
  // first coin in ("Hold some"), and how many separate coins the wallet
  // holds ("There are no balances").
  //
  // The answer is typed in digits, with or without commas, as the Send
  // screen takes an amount; a period is refused with the reason. It is
  // judged against the wallet as it stands at the moment "Check" is
  // pressed (answerBlock and answerCoins in lib/doit/judge.ts), and the
  // sentence under the field says what was wrong with it without ever
  // saying what the number is. A right answer ticks the part.
  //
  // What was typed stays in the field after a wrong answer, so that it can
  // be put right, and focus goes back to the field: the sentence under it
  // is the field's description, and is read out there.

  import { tick } from 'svelte';
  import Button from '../../components/Button.svelte';
  import Field from '../../components/Field.svelte';
  import TextInput from '../../components/TextInput.svelte';
  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { answerBlock, answerCoins, type Answer } from '../../lib/doit/judge.ts';
  import type { StepId } from '../../lib/doit/steps.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import { answerKey, type NumberAsk } from './ask.ts';

  interface Props {
    /** The step whose open part asks. */
    id: StepId;
    ask: NumberAsk;
    /** The answer was right, and the part is ticked. */
    onticked: () => void;
  }

  let { id, ask, onticked }: Props = $props();

  const doit = useDoit();

  let t = $derived(strings.doit[router.lang]);

  let typed = $state('');
  /** How the last answer was judged, when it did not tick the part. */
  let answer = $state<Answer | null>(null);
  let input = $state<ReturnType<typeof TextInput>>();

  let error = $derived.by(() => {
    if (answer === null) return '';
    const key = answerKey(ask, answer);
    return key === null ? '' : t[key];
  });

  async function check(): Promise<void> {
    // Judged against the wallet as it is now, not as it was when the screen was drawn.
    const seen = doit.seen(Date.now());
    const judged = ask === 'block' ? answerBlock(seen, typed) : answerCoins(seen, typed);
    if (judged === 'right') {
      // Right, and written: the part is ticked. Right, and not written: the question closed meanwhile.
      if (doit.answer(id)) {
        onticked();
        return;
      }
      answer = 'not-now';
      return;
    }
    answer = judged;
    await tick();
    input?.focus();
  }

  const HOOKS = {
    block: { answer: 'step-block-answer', check: 'step-block-check' },
    coins: { answer: 'step-coins-answer', check: 'step-coins-check' },
  } as const;
</script>

<div class="space-y-4">
  <Field label={ask === 'block' ? t.blockLabel : t.coinsLabel} hint={ask === 'block' ? t.blockHint : t.coinsHint} {error}>
    {#snippet children(field)}
      <TextInput
        {...field}
        bind:this={input}
        bind:value={typed}
        mono
        class="max-w-48"
        inputmode="numeric"
        autocomplete="off"
        enterkeyhint="done"
        data-testid={HOOKS[ask].answer}
        oninput={() => (answer = null)}
        onkeydown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void check();
        }}
      />
    {/snippet}
  </Field>
  <div>
    <Button variant="primary" class="w-full sm:w-auto" data-testid={HOOKS[ask].check} onclick={() => void check()}>{t.check}</Button>
  </div>
</div>
