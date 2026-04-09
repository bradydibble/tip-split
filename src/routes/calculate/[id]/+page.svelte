<script lang="ts">
  import type { PageData } from './$types';
  import { formatCents } from '$lib/calculator';

  let { data }: { data: PageData } = $props();

  let exporting = $state(false);
  let exportMsg = $state('');
  let exportLog = $state(data.exportLog);

  const lastExport = $derived(exportLog.length > 0 ? exportLog[0] : null);

  function formatExportTime(unixSec: number): string {
    return new Date(unixSec * 1000).toLocaleString();
  }

  async function exportToSheets() {
    if (lastExport) {
      const confirmed = confirm(
        `This calculation was already exported on ${formatExportTime(lastExport.exported_at)}.\n\nExport again?`
      );
      if (!confirmed) return;
    }

    exporting = true;
    exportMsg = '';
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calculationId: data.calc.id }),
      });
      const json = await res.json();
      if (res.ok) {
        exportMsg = `Exported (Export #${json.exportId})`;
        // Update local export log so button reflects new state without a page reload
        exportLog = [{ id: json.exportId, calculation_id: data.calc.id, exported_at: Math.floor(Date.now() / 1000), exported_by: null, location_id: 1 }, ...exportLog];
      } else {
        exportMsg = `Error: ${json.message}`;
      }
    } catch {
      exportMsg = 'Export failed — check Sheets config in Settings';
    }
    exporting = false;
  }

  const c = $derived(data.calc);
  const fohDists   = $derived(data.distributions.filter(d => d.role === 'FOH'));
  const barDists   = $derived(data.distributions.filter(d => d.role === 'Bar'));
  const kitDists   = $derived(data.distributions.filter(d => d.role === 'Kitchen'));
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/calculate" class="nav-back" aria-label="Back">←</a>
    <h2>{c.date} · {c.shift}</h2>
    <a href="/calculate/{c.id}/share" style="font-size:0.875rem;font-weight:600;">Share</a>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Summary -->
    <div class="card">
      <p class="label">Summary</p>
      <div class="row"><span>Gross Tips</span><span class="money">${formatCents(c.gross_tips_cents)}</span></div>
      <div class="row muted"><span>CC Fees ({(c.cc_fee_rate * 100).toFixed(1)}%)</span><span class="money">−${formatCents(c.cc_fees_cents)}</span></div>
      <div class="row total"><span>Tips After Fees</span><span class="money">${formatCents(c.tips_after_fees_cents)}</span></div>
    </div>

    <!-- Pool breakdown -->
    <div class="card">
      <p class="label">Pool Breakdown</p>
      <div class="row muted"><span>Kitchen Pool ({(c.kitchen_pct * 100).toFixed(0)}%)</span><span class="money">${formatCents(c.kitchen_pool_cents)}</span></div>
      <div class="row"><span>After Kitchen Pool</span><span class="money">${formatCents(c.tips_after_fees_cents - c.kitchen_pool_cents)}</span></div>
      <div class="row muted"><span>Liquor Sales</span><span class="money">${formatCents(c.liquor_sales_cents)}</span></div>
      <div class="row muted"><span>Bar Pool ({(c.bar_liquor_pct * 100).toFixed(0)}% of liquor)</span><span class="money">${formatCents(c.bar_pool_cents)}</span></div>
      <div class="row total"><span>FOH Pool</span><span class="money">${formatCents(c.foh_pool_cents)}</span></div>
    </div>

    <!-- Per-person -->
    {#if fohDists.length > 0}
      <div class="card">
        <p class="label">FOH — ${formatCents(c.foh_pool_cents)} ÷ {fohDists.length + barDists.length}</p>
        {#each fohDists as d}
          <div class="row">
            <span>{d.name}{#if d.staff_id}<span class="staff-id">#{d.staff_id}</span>{/if}</span>
            <span class="money amt">${formatCents(d.total_cents)}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if barDists.length > 0}
      <div class="card">
        <p class="label">Bar</p>
        {#each barDists as d}
          <div class="row">
            <span>{d.name}{#if d.staff_id}<span class="staff-id">#{d.staff_id}</span>{/if}</span>
            <div style="text-align:right;">
              <div class="money amt">${formatCents(d.total_cents)}</div>
              <div style="font-size:0.75rem;color:var(--muted);">
                ${formatCents(d.foh_share_cents)} FOH + ${formatCents(d.bar_pool_share_cents)} bar
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if kitDists.length > 0}
      <div class="card">
        <p class="label">Kitchen — ${formatCents(c.kitchen_pool_cents)} ÷ {kitDists.length}</p>
        {#each kitDists as d}
          <div class="row">
            <span>{d.name}{#if d.staff_id}<span class="staff-id">#{d.staff_id}</span>{/if}</span>
            <span class="money amt">${formatCents(d.total_cents)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Actions -->
    <div style="display:flex;flex-direction:column;gap:0.75rem;">
      {#if c.voided}
        <div class="card" style="text-align:center;padding:1rem;border:1.5px solid var(--danger);">
          <p style="color:var(--danger);font-weight:600;">This calculation has been voided</p>
        </div>
      {:else}
        <a href="/calculate/{c.id}/share" class="btn btn-primary">Share Card</a>

        <div>
          <button class="btn btn-secondary" onclick={exportToSheets} disabled={exporting} style="width:100%;">
            {#if exporting}
              Exporting…
            {:else if lastExport}
              Export Again to Google Sheets
            {:else}
              Export to Google Sheets
            {/if}
          </button>
          {#if lastExport && !exportMsg}
            <p style="font-size:0.75rem;color:var(--muted);text-align:center;margin-top:0.35rem;">
              Last exported {formatExportTime(lastExport.exported_at)} · Export #{lastExport.id}
            </p>
          {/if}
          {#if exportLog.length > 1}
            <p style="font-size:0.75rem;color:var(--muted);text-align:center;margin-top:0.2rem;">
              {exportLog.length} total exports
            </p>
          {/if}
          {#if exportMsg}
            <p class:success-msg={!exportMsg.startsWith('Error')} class:error-msg={exportMsg.startsWith('Error')}
               style="text-align:center;margin-top:0.35rem;">
              {exportMsg}
            </p>
          {/if}
        </div>

        <form method="POST" action="?/void">
          <button type="submit" class="btn btn-danger"
            onclick={e => { if (!confirm('Void this calculation? A VOID row will be added to Google Sheets.')) e.preventDefault(); }}>
            Void Calculation
          </button>
        </form>
      {/if}
      <a href="/calculate" class="btn btn-secondary">New Calculation</a>
    </div>
  </div>
</div>

<style>
  .row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 1rem;
  }
  .row:last-child { border-bottom: none; }
  .row.muted { color: var(--muted); }
  .row.total { font-weight: 700; color: var(--text); }
  .amt { font-size: 1.1rem; font-weight: 600; color: var(--primary); }
  .staff-id {
    font-size: 0.7rem;
    color: var(--muted);
    margin-left: 0.3rem;
    font-weight: 400;
  }
</style>
