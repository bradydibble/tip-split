<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();

  let pin = $state('');
  let loading = $state(false);

  const MAX = 6;
  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  function press(key: string) {
    if (pin.length < MAX) pin += key;
  }
  function back() { pin = pin.slice(0, -1); }
</script>

<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1rem;">
  <div style="background:var(--surface);border-radius:var(--radius);padding:2rem;width:100%;max-width:320px;text-align:center;">
    <h1 style="font-size:2.25rem;font-weight:800;color:var(--primary);margin-bottom:0.25rem;">TipSplit</h1>
    <p style="color:var(--muted);margin-bottom:2rem;">Enter your PIN</p>

    <form method="POST" use:enhance={() => {
      loading = true;
      return ({ update }) => { loading = false; pin = ''; update(); };
    }}>
      <input type="hidden" name="pin" value={pin} />

      <!-- PIN dots -->
      <div style="display:flex;gap:0.75rem;justify-content:center;margin-bottom:1.25rem;">
        {#each { length: MAX } as _, i}
          <div style="
            width:14px;height:14px;border-radius:50%;
            border:2px solid {i < pin.length ? 'var(--primary)' : 'var(--border)'};
            background:{i < pin.length ? 'var(--primary)' : 'transparent'};
            transition:background 0.1s,border-color 0.1s;
          "></div>
        {/each}
      </div>

      {#if form?.error}
        <p class="error-msg">{form.error}</p>
      {/if}

      <!-- Keypad -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.625rem;margin-bottom:1rem;">
        {#each KEYS as key}
          {#if key === '⌫'}
            <button type="button" onclick={back}
              style="background:var(--bg);color:var(--muted);border-radius:10px;height:64px;font-size:1.4rem;-webkit-tap-highlight-color:transparent;">
              ⌫
            </button>
          {:else if key === ''}
            <div style="height:64px;"></div>
          {:else}
            <button type="button" onclick={() => press(key)}
              style="background:var(--bg);color:var(--text);border-radius:10px;height:64px;font-size:1.6rem;font-weight:500;-webkit-tap-highlight-color:transparent;">
              {key}
            </button>
          {/if}
        {/each}
      </div>

      <button type="submit" class="btn btn-primary" disabled={pin.length < 4 || loading}>
        {loading ? 'Checking…' : 'Sign In'}
      </button>
    </form>
  </div>
</div>
