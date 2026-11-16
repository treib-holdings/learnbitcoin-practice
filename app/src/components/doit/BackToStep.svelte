<script lang="ts">
  // The way back to a "Do it" step, as a main button that names the step:
  // Back to "Pass it on".
  //
  // It stands where a reader has just done what a step sent them to do, or
  // what another step was waiting for, and is looking at the result:
  //
  //   - on the card of a done step that a need of another step sent the
  //     reader to: back to the step they came for (screens/doit/Done.svelte);
  //   - in the faucet's result on Receive, once the coins are here
  //     (screens/receive/FaucetState.svelte);
  //   - on Send's "Payment sent", once the step's payment is out
  //     (screens/send/Sent.svelte).
  //
  // The strip under the header has the same way back, and says which step
  // is followed. But on a phone the strip is above the window by the time
  // a result shows, and nothing else in view names the step: so the button
  // names it.
  //
  // The piece decides nothing and reads nothing of the note: it is handed
  // the step, and the test hook of the place it stands in. It leads to the
  // step's own screen, in the language of the page, and its address
  // carries nothing else. It is a link drawn by Button, like every move
  // between two screens of the app: after the faucet's bot check that move
  // loads a page, as every move does then.

  import { STEP_DEFS, type StepId } from '../../lib/doit/steps.ts';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Button from '../Button.svelte';

  interface Props {
    /** The step the button leads back to. */
    step: StepId;
    [key: `data-${string}`]: string | undefined;
  }

  let { step, ...rest }: Props = $props();

  let t = $derived(strings.doit[router.lang]);
</script>

<!-- As wide as the screen on a phone, like the main button of every step. -->
<Button {...rest} variant="primary" class="w-full sm:w-auto" href={router.link({ name: 'step', id: step })}>
  {fill(t.backTo, { step: t[STEP_DEFS[step].title] })}
</Button>
