<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  import { formatCents } from '$lib/calculator';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let selectedDate = $state(data.targetDate);

  $effect(() => {
    selectedDate = data.targetDate;
  });

  const stateBadge = (state: string) => {
    const map: Record<string, string> = {
      DRAFT: 'color:var(--muted);background:var(--bg);',
      READY_FOR_REVIEW: 'color:var(--primary);background:var(--surface2);',
      FINALIZED: 'color:var(--success);background:var(--bg);',
      VOIDED: 'color:var(--danger);background:var(--bg);',
    };
    return map[state] ?? map.DRAFT;
  };
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/calculate" class="nav-back" aria-label="Back">←</a>
    <h2>Shift Reports</h2>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Date selector -->
    <div class="card">
      <form method="GET" action="">
        <label class="field" style="border:none;padding:0;">
          <span>Business Date</span>
          <input class="input" type="date" name="date" value={selectedDate}
            onchange={(e) => e.currentTarget.form?.submit()} style="width:160px;" />
        </label>
      </form>
    </div>

    {#if data.reports.length === 0}
      <div class="card" style="text-align:center;padding:2rem;">
        <p style="color:var(--muted);">No shift reports for {selectedDate}.</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-top:0.5rem;">
          Reports are created automatically by the scheduler or manually in Settings → Square.
        </p>
      </div>
    {/if}

    <!-- Report tabs -->
    {#if data.reports.length > 0}
      <div class="tab-bar">
        {#each data.reports as rpt}
          <a href={`/reports?date=${rpt.business_date}&shift=${rpt.shift_type}`}
             class="tab" class:active={data.selectedReport?.id === rpt.id}>
            {rpt.shift_type}
            <span class="tab-state" style={stateBadge(rpt.state)}>{rpt.state.replace(/_/g, ' ')}</span>
          </a>
        {/each}
      </div>
    {/if}

    <!-- Selected report detail -->
    {#if data.selectedReport}
      {@const r = data.selectedReport}
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <p class="label" style="margin:0;">{r.shift_type} Report — {r.business_date}</p>
          <span class="badge" style={stateBadge(r.state)}>{r.state.replace(/_/g, ' ')}</span>
        </div>

        <!-- Financial summary -->
        <div class="fin-grid">
          <div class="fin-cell">
            <div class="fin-label">Square Tips</div>
            <div class="fin-val money">{formatCents(r.square_tips_cents)}</div>
            <div class="fin-source">Square synced</div>
          </div>
          <div class="fin-cell">
            <div class="fin-label">Manual Tips</div>
            <div class="fin-val money">{formatCents(r.manual_tips_cents)}</div>
            <div class="fin-source">Manual adjustment</div>
          </div>
          <div class="fin-cell">
            <div class="fin-label">Square Liquor</div>
            <div class="fin-val money">{formatCents(r.square_liquor_sales_cents)}</div>
            <div class="fin-source">Classified orders</div>
          </div>
          <div class="fin-cell">
            <div class="fin-label">Manual Liquor</div>
            <div class="fin-val money">{formatCents(r.manual_liquor_cents)}</div>
            <div class="fin-source">Manual adjustment</div>
          </div>
        </div>

        <div class="fin-total">
          <span>Total Tips: <strong class="money">{formatCents(r.square_tips_cents + r.manual_tips_cents)}</strong></span>
          <span>Total Liquor: <strong class="money">{formatCents(r.square_liquor_sales_cents + r.manual_liquor_cents)}</strong></span>
        </div>

        {#if r.latest_sync_run_id}
          <div style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem;">
            Last sync run #{r.latest_sync_run_id} • Source: {r.source} • Close: {r.close_source}
          </div>
        {/if}
      </div>

      <!-- Actions for non-finalized reports -->
      {#if r.state !== 'FINALIZED' && r.state !== 'VOIDED'}
        <!-- Re-sync -->
        <div class="card">
          <form method="POST" action="?/resync" use:enhance>
            <input type="hidden" name="report_id" value={r.id} />
            <button type="submit" class="btn btn-secondary" style="font-size:0.9rem;">
              ↻ Re-sync from Square
            </button>
          </form>
          {#if form?.resync}
            {@const rs = form.resync}
            <div style="margin-top:0.5rem;font-size:0.8rem;">
              <span style="color:var(--success);">Re-synced:</span>
              {rs.paymentsCount} payments, {rs.ordersCount} orders.
              Tips {formatCents(rs.squareTipsCents)}, Liquor {formatCents(rs.squareLiquorCents)}.
              {#if rs.attendanceChanges.added}<span style="color:var(--success);">+{rs.attendanceChanges.added} added. </span>{/if}
              {#if rs.attendanceChanges.removed}<span style="color:var(--danger);">-{rs.attendanceChanges.removed} removed. </span>{/if}
              {#if rs.attendanceChanges.rolePreserved}{rs.attendanceChanges.rolePreserved} roles preserved. {/if}
            </div>
          {/if}
          {#if form?.error}<p class="error-msg" style="margin-top:0.5rem;">{form.error}</p>{/if}
        </div>

        <!-- Manual adjustments -->
        <div class="card">
          <p class="label">Manual Adjustments</p>
          <form method="POST" action="?/adjustManual" use:enhance style="display:flex;gap:0.75rem;flex-wrap:wrap;">
            <input type="hidden" name="report_id" value={r.id} />
            <label style="flex:1;min-width:120px;">
              <span style="font-size:0.75rem;color:var(--muted);display:block;margin-bottom:0.25rem;">Extra Tips ($)</span>
              <input class="input" type="number" step="0.01" name="manual_tips"
                value={(r.manual_tips_cents / 100).toFixed(2)} />
            </label>
            <label style="flex:1;min-width:120px;">
              <span style="font-size:0.75rem;color:var(--muted);display:block;margin-bottom:0.25rem;">Extra Liquor ($)</span>
              <input class="input" type="number" step="0.01" name="manual_liquor"
                value={(r.manual_liquor_cents / 100).toFixed(2)} />
            </label>
            <button type="submit" class="btn btn-secondary" style="align-self:flex-end;font-size:0.85rem;padding:0.6rem 1rem;">
              Update
            </button>
          </form>
        </div>
      {/if}

      <!-- Attendance / Role confirmation -->
      <div class="card">
        <p class="label">Attendance & Role Confirmation</p>

        <!-- Included/Needs Review -->
        {#each data.attendance.filter(a => a.inclusion_state !== 'EXCLUDED' && a.inclusion_state !== 'REMOVED') as att}
          <div class="att-row" class:confirmed={att.role_confirmed}>
            <div class="att-info">
              <span class="att-name">{att.staff_name ?? att.name_snapshot}</span>
              {#if att.scheduled_job_title}
                <span class="badge">{att.scheduled_job_title}</span>
              {/if}
              {#if att.inclusion_state === 'NEEDS_REVIEW'}
                <span class="badge" style="color:var(--primary);border-color:var(--primary);">Needs Review</span>
              {/if}
              {#if att.role_confirmed}
                <span class="badge badge-current">Confirmed</span>
              {/if}
            </div>
            {#if r.state !== 'FINALIZED'}
              <form method="POST" action="?/confirmRole" use:enhance class="role-form">
                <input type="hidden" name="attendance_id" value={att.id} />
                <select name="role" class="input role-select">
                  {#each ['FOH', 'BAR', 'KITCHEN', 'BUSSER', 'EXCLUDED'] as rr}
                    <option value={rr} selected={att.selected_role === rr}>{rr}</option>
                  {/each}
                </select>
                <button type="submit" class="btn-confirm">Confirm</button>
              </form>
            {:else}
              <span class="badge" style="color:var(--success);border-color:var(--success);">{att.selected_role ?? att.default_role ?? '—'}</span>
            {/if}
          </div>
        {/each}

        <!-- Excluded (collapsed) -->
        {#if data.attendance.filter(a => a.inclusion_state === 'EXCLUDED').length > 0}
          {@const excl = data.attendance.filter(a => a.inclusion_state === 'EXCLUDED')}
          <details style="margin-top:0.75rem;">
            <summary style="font-size:0.85rem;color:var(--muted);cursor:pointer;">
              Scheduled but excluded ({excl.length})
            </summary>
            {#each excl as att}
              <div class="att-row excluded">
                <div class="att-info">
                  <span class="att-name" style="color:var(--muted);">{att.staff_name ?? att.name_snapshot}</span>
                  {#if att.scheduled_job_title}<span class="badge">{att.scheduled_job_title}</span>{/if}
                  <span class="badge" style="color:var(--danger);border-color:var(--danger);">Excluded</span>
                </div>
              </div>
            {/each}
          </details>
        {/if}

        <!-- Removed -->
        {#if data.attendance.filter(a => a.inclusion_state === 'REMOVED').length > 0}
          {@const removed = data.attendance.filter(a => a.inclusion_state === 'REMOVED')}
          <details style="margin-top:0.5rem;">
            <summary style="font-size:0.85rem;color:var(--muted);cursor:pointer;">
              Removed by re-sync ({removed.length})
            </summary>
            {#each removed as att}
              <div class="att-row excluded">
                <div class="att-info">
                  <span class="att-name" style="color:var(--muted);text-decoration:line-through;">{att.staff_name ?? att.name_snapshot}</span>
                  <span class="badge" style="color:var(--danger);border-color:var(--danger);">Removed</span>
                </div>
              </div>
            {/each}
          </details>
        {/if}
      </div>

      <!-- Add unscheduled staff (people who worked but aren't on the schedule) -->
      {#if r.state !== 'FINALIZED' && r.state !== 'VOIDED'}
        <div class="card">
          <p class="label">Add Unscheduled Staff</p>
          <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">
            Someone worked but wasn't on the schedule? Add them here.
          </p>
          <form method="POST" action="?/addUnscheduled" use:enhance style="display:flex;gap:0.5rem;align-items:center;">
            <input type="hidden" name="report_id" value={r.id} />
            <select name="staff_id" class="input" style="flex:1;font-size:0.85rem;" required>
              <option value="">Select staff member…</option>
              {#each data.allActiveStaff as s}
                <option value={s.id}>
                  {s.name} ({s.role})
                  {#if s.default_tip_split_role && s.default_tip_split_role !== s.role.toUpperCase()}
                    — default: {s.default_tip_split_role}
                  {/if}
                </option>
              {/each}
            </select>
            <button type="submit" class="btn btn-secondary" style="width:auto;font-size:0.85rem;padding:0.5rem 1rem;">
              Add
            </button>
          </form>
          {#if form?.addedUnscheduled}
            <p class="success-msg" style="margin-top:0.5rem;">Added {form.addedUnscheduled} to the report.</p>
          {/if}
        </div>
      {/if}

      <!-- Finalize -->
      {#if r.state !== 'FINALIZED' && r.state !== 'VOIDED'}
        <div class="card">
          <form method="POST" action="?/finalize" use:enhance>
            <input type="hidden" name="report_id" value={r.id} />
            <button type="submit" class="btn btn-primary">
              Finalize & Create Calculation
            </button>
          </form>
          {#if form?.error}
            <p class="error-msg" style="margin-top:0.5rem;">{form.error}</p>
          {/if}
          <p style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem;">
            Finalization locks the report and creates a TipSplit calculation.
            All included participants must have confirmed roles.
          </p>
        </div>
      {/if}
    {/if}

  </div>
</div>

<style>
  .tab-bar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .tab {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem;
    text-align: center;
    text-decoration: none;
    color: var(--text);
    font-weight: 600;
    font-size: 0.9rem;
  }
  .tab.active { border-color: var(--primary); background: var(--surface2); }
  .tab-state {
    display: block;
    font-size: 0.65rem;
    font-weight: 400;
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
    margin-top: 0.2rem;
  }

  .fin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .fin-cell {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem;
  }
  .fin-label { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .fin-val { font-size: 1.2rem; font-weight: 700; }
  .fin-source { font-size: 0.65rem; color: var(--muted); }
  .fin-total {
    display: flex;
    justify-content: space-around;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .fin-total strong { font-size: 1.1rem; color: var(--primary); }

  .att-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }
  .att-row.confirmed { opacity: 1; }
  .att-row.excluded { padding-left: 1rem; }
  .att-info { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .att-name { font-weight: 600; }
  .role-form { display: flex; gap: 0.25rem; align-items: center; }
  .role-select {
    font-size: 0.8rem;
    padding: 0.3rem 0.5rem;
    width: auto;
    height: auto;
  }
  .btn-confirm {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.3rem 0.6rem;
    color: var(--primary);
  }
  .btn-confirm:hover { border-color: var(--primary); }

  .field { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.6rem 0; }
</style>
