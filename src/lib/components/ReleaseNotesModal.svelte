<script lang="ts">
  // "What's new" modal — shown once per user per release. The layout load
  // decides whether to render it; dismissing POSTs an acknowledgement so it
  // never appears again for this release.
  let {
    version,
    bullets,
  }: { version: string; bullets: readonly string[] } = $props();

  let dismissed = $state(false);

  async function dismiss() {
    if (dismissed) return;
    dismissed = true;
    try {
      await fetch('/api/release-notes/ack', { method: 'POST' });
    } catch {
      // If the ack is lost, the modal simply reappears next session.
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') dismiss(); }} />

{#if !dismissed}
  <div
    class="overlay"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
  >
    <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="release-title">
      <p class="label" style="margin-bottom:0.25rem;">TipSplit update</p>
      <h3 id="release-title">What's new in v{version}</h3>
      <ul>
        {#each bullets as note}
          <li>{note}</li>
        {/each}
      </ul>
      <button class="btn btn-primary" style="margin-top:1.25rem;" onclick={dismiss}>Got it</button>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 17, 0.78);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 100;
  }
  .modal { max-width: 26rem; width: 100%; }
  h3 { font-size: 1.25rem; margin-bottom: 0.85rem; }
  ul {
    padding-left: 1.1rem;
    display: grid;
    gap: 0.55rem;
    font-size: 0.9rem;
    line-height: 1.45;
  }
</style>
