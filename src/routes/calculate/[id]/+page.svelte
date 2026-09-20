<script lang="ts">
  import type { PageData } from './$types';
  import { enhance, applyAction } from '$app/forms';
  import { formatCents } from '$lib/calculator';
  import { interpretActionResult } from '$lib/adjust-result';
  import type { DistRow } from '$lib/server/db';

  let { data }: { data: PageData } = $props();

  let exporting = $state(false);
  let exportMsg = $state('');
  let exportLog = $state(data.exportLog);

  const lastExport = $derived(exportLog.length > 0 ? exportLog[0] : null);

  // Adjustment modal state
  let showAdjustmentModal = $state(false);
  let selectedStaffId = $state<number | null>(null);
  let selectedAdjustment = $state<number | null>(null);
  let adjustmentReason = $state('');
  let adjustError = $state('');
  let adjusting = $state(false);

  function formatExportTime(unixSec: number): string {
    return new Date(unixSec * 1000).toLocaleString();
  }

  // Pre-adjustment "natural" share for a distribution row:
  // total_cents reflects post-adjustment; reversing adjustment_cents
  // yields the calculator's original split.
  function originalBase(d: { total_cents: number; adjustment_cents: number }): number {
    return d.total_cents - d.adjustment_cents;
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
        // Use server-returned values to match the actual audit log record
        exportLog = [{ id: json.exportId, calculation_id: data.calc.id, exported_at: json.exportedAtUnix, exported_by: json.exportedBy, location_id: 1 }, ...exportLog];
      } else {
        exportMsg = `Error: ${json.message}`;
      }
    } catch {
      exportMsg = 'Export failed — check Sheets config in Settings';
    }
    exporting = false;
  }

  const c = $derived(data.calc);

function openAdjustmentModal(staffId: number) {
  selectedStaffId = staffId;
  selectedAdjustment = null;
  adjustmentReason = '';
  adjustError = '';
  showAdjustmentModal = true;
}

function setSelectedAdjustment(adj: number) {
  selectedAdjustment = adj;
  adjustError = '';
}

// The action answers HTTP 200 for rejections as well as successes, so the
// outcome has to come from `result.type` — see $lib/adjust-result.
const submitAdjustment = () => {
  adjusting = true;
  adjustError = '';
  return async ({ result }: { result: import('@sveltejs/kit').ActionResult }) => {
    adjusting = false;
    const outcome = interpretActionResult(result);
    if (outcome.kind === 'applied') {
      showAdjustmentModal = false;
      // Follows the action's 303 and re-runs `load`, refreshing the totals.
      await applyAction(result);
    } else {
      // Keep the modal open so the message is read next to the choice
      // that caused it.
      adjustError = outcome.message;
    }
  };
};

  const fohDists    = $derived(data.distributions.filter(d => d.role === 'FOH'));
  const barDists    = $derived(data.distributions.filter(d => d.role === 'Bar'));
  const kitDists    = $derived(data.distributions.filter(d => d.role === 'Kitchen'));
  const busserDists = $derived(data.distributions.filter(d => d.role === 'Busser'));
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
      {#if c.busser_pool_cents > 0}
        <div class="row muted"><span>Busser Pool ({busserDists.length} × ${formatCents(c.busser_pool_cents / busserDists.length)})</span><span class="money">−${formatCents(c.busser_pool_cents)}</span></div>
      {/if}
      <div class="row muted"><span>Liquor Sales</span><span class="money">${formatCents(c.liquor_sales_cents)}</span></div>
      <div class="row muted"><span>Bar Pool ({(c.bar_liquor_pct * 100).toFixed(0)}% of liquor)</span><span class="money">${formatCents(c.bar_pool_cents)}</span></div>
      <div class="row total"><span>FOH Pool</span><span class="money">${formatCents(c.foh_pool_cents)}</span></div>
    </div>

    <!-- Per-person -->
    {#snippet distRow(d: DistRow, showBreakdown: boolean)}
      <div class="row">
        <span>{d.name}{#if d.staff_id}<span class="staff-id">#{d.staff_id}</span>{/if}</span>
        <div style="text-align:right;">
          <div style="display:flex;align-items:center;gap:0.5rem;justify-content:flex-end;">
            {#if d.adjustment_cents !== 0}
              <span class="adj-original" title="Original share before adjustment">
                ${formatCents(originalBase(d))}
              </span>
              <span class="adj-arrow">→</span>
              <span class="adj-flag" title="Adjustment applied">
                {d.adjustment_cents < 0 ? '−' : '+'}${formatCents(Math.abs(d.adjustment_cents))}
              </span>
            {/if}
            <span class="money amt" class:adj-final={d.adjustment_cents !== 0}>${formatCents(d.total_cents)}</span>
            {#if !c.voided && d.staff_id}
              <button type="button" class="adj-btn" onclick={() => openAdjustmentModal(d.staff_id!)} aria-label="Adjust share">⚙</button>
            {/if}
          </div>
          {#if showBreakdown && (d.foh_share_cents > 0 || d.bar_pool_share_cents > 0 || d.kitchen_share_cents > 0 || d.busser_share_cents > 0)}
            <div class="pool-breakdown">
              {#if d.foh_share_cents > 0}<span class="pb-chip pb-foh">FOH ${formatCents(d.foh_share_cents)}</span>{/if}
              {#if d.bar_pool_share_cents > 0}<span class="pb-chip pb-bar">Bar ${formatCents(d.bar_pool_share_cents)}</span>{/if}
              {#if d.kitchen_share_cents > 0}<span class="pb-chip pb-kit">Kit ${formatCents(d.kitchen_share_cents)}</span>{/if}
              {#if d.busser_share_cents > 0}<span class="pb-chip pb-bus">Bus ${formatCents(d.busser_share_cents)}</span>{/if}
            </div>
          {/if}
        </div>
      </div>
    {/snippet}

    {#if fohDists.length > 0}
      <div class="card">
        <p class="label">FOH — ${formatCents(c.foh_pool_cents)} ÷ {fohDists.length + barDists.length}</p>
        {#each fohDists as d}{@render distRow(d, false)}{/each}
      </div>
    {/if}

    {#if barDists.length > 0}
      <div class="card">
        <p class="label">Bar — earns FOH pool share <em>and</em> bar pool share</p>
        {#each barDists as d}{@render distRow(d, true)}{/each}
      </div>
    {/if}

    {#if kitDists.length > 0}
      <div class="card">
        <p class="label">Kitchen — ${formatCents(c.kitchen_pool_cents)} ÷ {kitDists.length}</p>
        {#each kitDists as d}{@render distRow(d, false)}{/each}
      </div>
    {/if}

    {#if busserDists.length > 0}
      <div class="card">
        <p class="label">Bussers — ${formatCents(c.busser_pool_cents)} ({busserDists.length} × ${formatCents(c.busser_pool_cents / busserDists.length)})</p>
        {#each busserDists as d}{@render distRow(d, false)}{/each}
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

  <!-- Adjustment Modal -->
  {#if showAdjustmentModal}
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;justify-content:center;align-items:center;">
      <div style="background:var(--bg);padding:1.5rem;border-radius:12px;max-width:400px;width:90%;
                  box-shadow:0 8px 32px rgba(0,0,0,0.2);">
        <h3 style="margin:0 0 1rem 0;">Adjust Tips</h3>
        <p style="font-size:0.9rem;margin-bottom:1rem;">
          Select an adjustment to apply to this staff member. The withheld amount is redistributed to other staff in the same role (or downstream if they were alone in that role).
        </p>
        <form method="POST" action="?/adjust" use:enhance={submitAdjustment}>
          <input type="hidden" name="staffId" value={selectedStaffId} />
          <input type="hidden" name="adjustment" value={selectedAdjustment} />

          <div class="pct-grid">
            {#each [-20, -25, -40, -50] as adj}
              <button
                type="button"
                class="pct-btn"
                class:selected={selectedAdjustment === adj}
                aria-pressed={selectedAdjustment === adj}
                onclick={() => setSelectedAdjustment(adj)}
              >
                {adj}%
              </button>
            {/each}
          </div>

          <div style="margin-bottom:0.75rem;">
            <label for="adj-reason" style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:0.25rem;">Reason (optional)</label>
            <input id="adj-reason" name="reason" type="text" class="input" bind:value={adjustmentReason} style="width:100%;" placeholder="e.g., Late arrival" />
          </div>

          {#if adjustError}
            <p class="error-msg" role="alert">{adjustError}</p>
          {/if}

          <div style="display:flex;justify-content:space-between;">
            <button type="button" class="btn btn-secondary" onclick={() => showAdjustmentModal = false} style="width:48%;" disabled={adjusting}>Cancel</button>
            <button type="submit" class="btn btn-primary" style="width:48%;" disabled={selectedAdjustment === null || adjusting}>
              {adjusting ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

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
  .adj-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.15rem 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
    cursor: pointer;
    line-height: 1;
  }
  .adj-btn:active { color: var(--primary); border-color: var(--primary); }
  .pct-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  /* The global `button { border: none }` reset zeroes border-width and
     border-style, so a selected state expressed only as `border-color`
     paints nothing. Declare the whole border here — transparent when
     unselected so selecting does not shift the layout — and change the
     fill too, which reads at a glance on a phone. */
  .pct-btn {
    width: 100%;
    padding: 0.6rem;
    border: 1.5px solid transparent;
    border-radius: var(--radius);
    background: var(--surface2);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
    transition: background 0.1s, border-color 0.1s;
  }
  .pct-btn.selected {
    border-color: var(--primary);
    background: var(--primary);
    color: #000;
    font-weight: 700;
  }
  .adj-flag {
    font-size: 0.7rem;
    color: var(--warning, #c88);
    white-space: nowrap;
  }
  .adj-original {
    font-size: 0.75rem;
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: var(--muted);
    white-space: nowrap;
  }
  .adj-arrow {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .adj-final { font-weight: 800; }
  .pool-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    justify-content: flex-end;
    margin-top: 0.25rem;
  }
  .pb-chip {
    font-size: 0.65rem;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    white-space: nowrap;
    border: 1px solid var(--border);
    color: var(--muted);
    background: var(--bg);
  }
  .pb-foh { border-color: #4a9; color: #4a9; }
  .pb-bar { border-color: #c84; color: #c84; }
  .pb-kit { border-color: #69c; color: #69c; }
  .pb-bus { border-color: #c4c; color: #c4c; }
</style>
