<script lang="ts">
  // What the list of steps and a step's screen say, at their top, when the
  // progress of the steps cannot be read or cannot be kept:
  //
  //   newer  a note written by a newer version of this page is stored (a
  //          tab left open across an update). This version reads nothing of
  //          it, writes nothing and deletes nothing: the one way on is
  //          Reload.
  //   unread the browser did not let this page read its storage at all.
  //          That is not "no progress": a note made before may still be
  //          stored. So the notice says that the page cannot tell, and
  //          the list under it shows no state for any step.
  //   no     the browser will not store anything for this page, or refused
  //          the last write: progress cannot be kept here.
  //
  // It draws nothing while progress can be kept. Each notice is there
  // when the screen opens, so none is read out as an alert.

  import Notice from '../../components/Notice.svelte';
  import ReloadButton from '../../components/wallet/ReloadButton.svelte';
  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';

  const doit = useDoit();

  let t = $derived(strings.doit[router.lang]);
</script>

{#if doit.kept === 'newer'}
  <Notice kind="problem" silent text={t.newer} data-testid="do-newer">
    <ReloadButton />
  </Notice>
{:else if doit.read === 'blocked'}
  <Notice kind="problem" silent text={t.noRead} data-testid="do-no-read">
    <ReloadButton />
  </Notice>
{:else if doit.kept === 'no'}
  <Notice kind="problem" silent text={t.noStorage} data-testid="do-no-storage">
    <ReloadButton />
  </Notice>
{/if}
