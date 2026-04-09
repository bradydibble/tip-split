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

  let copyFeedback = $state('');

  function buildShareText(): string {
    const lines: string[] = [
      `TipSplit — ${c.date} · ${c.shift} Shift`,
      '',
      `Gross Tips:      $${formatCents(c.gross_tips_cents)}`,
      `CC Fees:        −$${formatCents(c.cc_fees_cents)}`,
      `Kitchen Pool:    $${formatCents(c.kitchen_pool_cents)}`,
    ];
    if (c.bar_pool_cents > 0) {
      lines.push(`Bar Pool:        $${formatCents(c.bar_pool_cents)}`);
    }
    lines.push('');
    for (const d of sorted) {
      lines.push(`${d.name} (${d.role}): $${formatCents(d.total_cents)}`);
    }
    const total = dists.reduce((s, d) => s + d.total_cents, 0);
    lines.push('', `Total Distributed: $${formatCents(total)}`);
    return lines.join('\n');
  }

  async function shareViaMessenger() {
    const text = buildShareText();
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'TipSplit', text });
      } catch {
        // user cancelled or share failed — do nothing
      }
    } else {
      await navigator.clipboard.writeText(text);
      copyFeedback = 'Copied!';
      setTimeout(() => { copyFeedback = ''; }, 2000);
    }
  }
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

  <div class="share-actions">
    <button class="share-btn" onclick={shareViaMessenger}>
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 2 11 13"/>
        <path d="M22 2 15 22 11 13 2 9l20-7z"/>
      </svg>
      {copyFeedback || 'Share via Messenger'}
    </button>
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

  .share-actions {
    margin-top: 1.25rem;
    width: 100%;
    max-width: 360px;
    display: flex;
    justify-content: center;
  }

  .share-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--primary);
    color: #0f172a;
    border: none;
    border-radius: 10px;
    padding: 0.75rem 1.5rem;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    width: 100%;
    justify-content: center;
    transition: opacity 0.15s;
  }

  .share-btn:hover { opacity: 0.85; }
  .share-btn:active { opacity: 0.7; }
</style>
