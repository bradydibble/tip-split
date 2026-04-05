<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <title>TipSplit</title>
</svelte:head>

{@render children()}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }

  :global(:root) {
    --bg:           #0f172a;
    --surface:      #1e293b;
    --surface2:     #263347;
    --border:       #334155;
    --text:         #f1f5f9;
    --muted:        #94a3b8;
    --primary:      #f59e0b;
    --primary-dark: #d97706;
    --success:      #10b981;
    --danger:       #ef4444;
    --radius:       12px;
    --font:         -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  :global(body) {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    min-height: 100dvh;
    -webkit-font-smoothing: antialiased;
  }

  :global(button) { cursor: pointer; font-family: inherit; border: none; outline: none; }
  :global(input, select) { font-family: inherit; }
  :global(a) { color: var(--primary); text-decoration: none; }

  :global(.page) {
    max-width: 480px;
    margin: 0 auto;
    padding: 1rem;
    min-height: 100dvh;
  }

  :global(.card) {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  :global(.label) {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 0.5rem;
    display: block;
  }

  :global(.input) {
    width: 100%;
    background: var(--bg);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 1.1rem;
    padding: 0.75rem 1rem;
    appearance: none;
  }
  :global(.input:focus) { outline: none; border-color: var(--primary); }

  :global(.btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: var(--radius);
    font-size: 1rem;
    font-weight: 600;
    padding: 0.875rem 1.25rem;
    width: 100%;
    transition: opacity 0.1s, background 0.1s;
  }
  :global(.btn:disabled) { opacity: 0.4; cursor: not-allowed; }
  :global(.btn-primary) { background: var(--primary); color: #000; }
  :global(.btn-primary:not(:disabled):active) { background: var(--primary-dark); }
  :global(.btn-secondary) { background: var(--surface2); color: var(--text); }
  :global(.btn-danger) { background: var(--danger); color: #fff; }

  :global(.error-msg) { color: var(--danger); font-size: 0.875rem; margin-bottom: 0.75rem; }
  :global(.success-msg) { color: var(--success); font-size: 0.875rem; margin-bottom: 0.75rem; }

  :global(.nav) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0;
    background: var(--surface);
  }
  :global(.nav h2) { flex: 1; font-size: 1.1rem; font-weight: 600; }
  :global(.nav-back) {
    background: none;
    color: var(--primary);
    font-size: 1.25rem;
    padding: 0.25rem;
    line-height: 1;
  }

  :global(.money) {
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
  }
</style>
