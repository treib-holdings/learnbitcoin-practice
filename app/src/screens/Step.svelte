<script lang="ts">
  // One "Do it" step: /do/<id>, /es/do/<id>.
  //
  // A step is something a chapter of the main site's Journey taught, done
  // by the reader in their own practice wallet and checked against the
  // practice chain. Its screen says what the step is for, in a sentence or
  // two, and then lists its parts (doit/StepBody.svelte): which are ticked,
  // which one is open, and what to do in it.
  //
  // Nobody needs a wallet to read it: the first part of the first step is
  // "make one". The router shows this screen only for one of the six steps
  // of the contract; any other text after /do/ is "not found".
  //
  // The screen stays on the page when the address moves on to another step
  // (a done step offers the next one of its chapter), as the transaction
  // screen does for another transaction. Everything under the heading is
  // made afresh for the new step: what was typed into one step's question
  // has no place in another's.
  //
  // Opening this screen is what starts a step and makes it the one being
  // followed. That is written by the steps themselves when App.svelte tells
  // them which screen is open, before this screen is drawn.

  import Page from '../components/Page.svelte';
  import { useDoit } from '../lib/doit/doit-context.ts';
  import { stepDef, type StepId } from '../lib/doit/steps.ts';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';
  import ProgressNotice from './doit/ProgressNotice.svelte';
  import StepBody from './doit/StepBody.svelte';
  import { ledeKey } from './doit/view.ts';

  // Asked for here so that a page without the steps fails when it is made, not when a part is opened.
  useDoit();

  let t = $derived(strings.doit[router.lang]);

  /** The step the address names. The router shows this screen for no other address. */
  let id = $derived<StepId>(router.route.name === 'step' ? router.route.id : 'hold-some');
  let title = $derived(t[stepDef(id).title]);
</script>

<Page eyebrow={t.name} {title} titleHook="step-title" lede={t[ledeKey(id)]}>
  <!-- Progress that cannot be read or kept is said first: it changes what every part below can do. -->
  <ProgressNotice />
  {#key id}
    <StepBody {id} />
  {/key}
</Page>
