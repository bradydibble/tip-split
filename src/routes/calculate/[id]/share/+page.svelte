<script lang="ts">
  import type { PageData } from './$types';
  import { formatCents } from '$lib/calculator';

  let { data }: { data: PageData } = $props();
  const c = data.calc;
  const dists = data.distributions;

  // Sort: FOH, Bar, Kitchen; alpha within group
  const sorted = $derived([...dists].sort((a, b) => {
    const order = { FOH: 0, Bar: 1, Kitchen: 2 } as Record<string, number>;
    return (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.name.localeCompare(b.name);
  }));
</script>

<!-- Clean share card — designed to screenshot, no chrome -->
<div class="share-wrap">
  <a href="/calculate/{c.id}" class="back" aria-label="Back">←</a>

  <div class="share-card">
    <header>
      <span class="app">TipSplit</span>
      <span class="meta">{c.date} · {c.shift} Shift</span>
    </header>

    <section class="summary">
      <div class="sum-row">
        <span>Gross Tips</span>
        <span class="money">${formatCents(c.gross_tips_cents)}</span>
      </div>
      <div class="sum-row dim">
        <span>CC Fees</span>
        <span class="money">−${formatCents(c.cc_fees_cents)}</span>
      </div>
      <div class="sum-row dim">
        <span>Kitchen Pool</span>
        <span class="money">${formatCents(c.kitchen_pool_cents)}</span>
      </div>
      {#if c.bar_pool_cents > 0}
        <div class="sum-row dim">
          <span>Bar Pool</span>
          <span class="money">${formatCents(c.bar_pool_cents)}</span>
        </div>
      {/if}
    </section>

    <div class="divider"></div>

    <section class="people">
      {#each sorted as d}
        <div class="person-row">
          <div>
            <span class="person-name">{d.name}</span>
            <span class="person-role">{d.role}</span>
          </div>
          <span class="person-amt money">${formatCents(d.total_cents)}</span>
        </div>
      {/each}
    </section>

    <div class="divider"></div>

    <div class="total-row">
      <span>Total Distributed</span>
      <span class="money total-amt">
        ${formatCents(dists.reduce((s, d) => s + d.total_cents, 0))}
      </span>
    </div>
  </div>
</div>

<style>
  .share-wrap {
    min-height: 100dvh;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1rem;
    position: relative;
  }

  .back {
    position: absolute;
    top: 1rem;
    left: 1rem;
    color: var(--muted);
    font-size: 1.25rem;
    text-decoration: none;
    padding: 0.5rem;
    line-height: 1;
  }

  .share-card {
    background: var(--surface);
    border-radius: 16px;
    padding: 1.5rem;
    width: 100%;
    max-width: 360px;
    margin-top: 3rem;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 1.25rem;
  }

  .app {
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--primary);
  }

  .meta {
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: 500;
  }

  .summary { margin-bottom: 1rem; }

  .sum-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
    padding: 0.3rem 0;
  }
  .sum-row.dim { color: var(--muted); }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0.75rem 0;
  }

  .people { display: flex; flex-direction: column; gap: 0.1rem; }

  .person-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--border);
  }
  .person-row:last-child { border-bottom: none; }

  .person-name { font-size: 1rem; font-weight: 500; display: block; }
  .person-role {
    font-size: 0.7rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .person-amt {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--primary);
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 700;
  }

  .total-amt {
    font-size: 1.1rem;
    color: var(--text);
  }
</style>
