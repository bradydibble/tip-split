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
    --text-xs:      0.75rem;
    --text-2xs:     0.7rem;
    --row-y:        0.75rem;
    --badge-radius: 9999px;
    --row-active:   var(--surface2);
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

  /* ── Phase 1.5 report patterns ─────────────────────────────────────── */

  /* Two-line card row: identity line + stats line. Not a <table> —
     mobile rows need to wrap and tap as a unit. */
  :global(.table-row) {
    display: block;
    padding: var(--row-y) 0;
    border-bottom: 1px solid var(--border);
    text-decoration: none;
    color: inherit;
    border-radius: 8px;
  }
  :global(.table-row:hover) { background: var(--row-active); }
  :global(.table-row .row-top) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  :global(.table-row .row-top .who) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 1rem;
    font-weight: 600;
    min-width: 0;
  }
  :global(.table-row .row-top .who .nm) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.table-row .row-top .amt) {
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  :global(.table-row .row-sub) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.2rem;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  :global(.badge) {
    display: inline-block;
    font-size: var(--text-2xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--badge-radius);
    padding: 0.1rem 0.45rem;
    white-space: nowrap;
    flex-shrink: 0;
  }
  :global(.badge-current) {
    color: var(--success);
    border-color: var(--success);
  }
  :global(.badge-upcoming) {
    color: var(--muted);
    background: var(--surface2);
  }

  /* Three-column stat strip (shifts / paid / active). */
  :global(.stats) {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
    text-align: center;
  }
  :global(.stats .stat) {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.25rem;
  }
  :global(.stats .stat .n) {
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  :global(.stats .stat .l) {
    font-size: var(--text-2xs);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Period nav: ‹ label › with 44px tap targets. */
  :global(.period-nav) {
    display: flex;
    align-items: stretch;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }
  :global(.period-nav button),
  :global(.period-nav a) {
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 1.1rem;
  }
  :global(.period-nav .period-label) {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.4rem 0.5rem;
    text-align: center;
    cursor: pointer;
  }
  :global(.period-nav .period-label .t) {
    font-size: 0.95rem;
    font-weight: 700;
  }
  :global(.period-nav .period-label .s) {
    font-size: var(--text-2xs);
    color: var(--muted);
  }
  :global(.period-nav button:disabled) { opacity: 0.3; cursor: default; }

  /* Sticky bottom footer for the report (grand total + CSV). */
  :global(.report-footer) {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0 -1rem;
    padding: 0.875rem 1rem calc(0.875rem + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  :global(.report-footer .grand) {
    font-size: 1.35rem;
    font-weight: 800;
    color: var(--primary);
    font-variant-numeric: tabular-nums;
  }
  :global(.report-footer .grand .l) {
    display: block;
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
