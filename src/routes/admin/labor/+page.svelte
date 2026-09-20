<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  import { formatCents } from '$lib/calculator';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let syncing = $state(false);
  let savingTax = $state(false);
  let uploading = $state(false);

  function hm(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  const syncEnhance = () => { syncing = true; return ({ update }: { update: () => void }) => { syncing = false; update(); }; };
  const taxEnhance = () => { savingTax = true; return ({ update }: { update: () => void }) => { savingTax = false; update(); }; };
  const uploadEnhance = () => { uploading = true; return ({ update }: { update: () => void }) => { uploading = false; update(); }; };
  const dollars = (cents: number) => formatCents(cents);

  const IMPORT_KIND_LABEL: Record<string, string> = {
    payroll_report: 'Payroll report',
    bank_transactions: 'Bank transactions',
    tax_filing: 'Tax filing',
    unknown: 'Unknown format',
  };
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/settings" class="nav-back" aria-label="Back">←</a>
    <h2>Labor Costs</h2>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Date range + sync -->
    <div class="card">
      <p class="label">Worked-Shift Window</p>
      <form method="GET" style="display:flex;gap:0.5rem;align-items:flex-end;flex-wrap:wrap;">
        <label style="flex:1;min-width:130px;">
          <span style="font-size:0.75rem;color:var(--muted);display:block;margin-bottom:0.25rem;">From</span>
          <input class="input" type="date" name="start" value={data.start} />
        </label>
        <label style="flex:1;min-width:130px;">
          <span style="font-size:0.75rem;color:var(--muted);display:block;margin-bottom:0.25rem;">To</span>
          <input class="input" type="date" name="end" value={data.end} />
        </label>
        <button type="submit" class="btn btn-secondary" style="width:auto;font-size:0.85rem;padding:0.6rem 1rem;">
          View
        </button>
      </form>
      <form method="POST" action="?/sync" use:enhance={syncEnhance} style="margin-top:0.75rem;">
        <input type="hidden" name="start" value={data.start} />
        <input type="hidden" name="end" value={data.end} />
        <button type="submit" class="btn btn-primary" disabled={syncing}>
          {syncing ? 'Syncing…' : '⟳ Sync Worked Shifts from Square'}
        </button>
      </form>
      {#if form?.laborSync}
        {@const s = form.laborSync}
        <p style="font-size:0.8rem;color:var(--success);margin-top:0.5rem;">
          Synced {s.fetched} shifts ({s.created} new, {s.updated} updated{s.openShifts ? `, ${s.openShifts} still open` : ''}).
          Straight-time {dollars(s.totalCostCents)}
          {s.declaredCashTipsCents ? ` • declared cash tips ${dollars(s.declaredCashTipsCents)}` : ''}
          {s.weekStartDay ? ` • OT week starts ${s.weekStartDay}` : ''}
        </p>
      {/if}
      {#if form?.syncError}
        <p class="error-msg" style="margin-top:0.5rem;">{form.syncError}</p>
      {/if}
      {#if data.totals.openShifts > 0}
        <p style="font-size:0.75rem;color:var(--muted);margin-top:0.4rem;">
          {data.totals.openShifts} shift(s) still open — their figures are provisional until clock-out.
        </p>
      {/if}
    </div>

    <!-- All-in totals -->
    <div class="card">
      <p class="label">All-In Labor Estimate — {data.start} → {data.end}</p>
      <div class="stats" style="grid-template-columns:repeat(2,1fr);">
        <div class="stat">
          <div class="n">{hm(data.totals.hoursMinutes)}</div>
          <div class="l">Clock Hours</div>
        </div>
        <div class="stat">
          <div class="n money">${dollars(data.totals.grossWageCents)}</div>
          <div class="l">Straight Wages</div>
        </div>
        {#if data.totals.overtimeMinutes > 0}
          <div class="stat">
            <div class="n money">${dollars(data.totals.overtimePremiumCents)}</div>
            <div class="l">OT Premium ({hm(data.totals.overtimeMinutes)})</div>
          </div>
        {/if}
        <div class="stat">
          <div class="n money">${dollars(data.totals.salaryRangeCents)}</div>
          <div class="l">Salary Alloc.</div>
        </div>
        <div class="stat">
          <div class="n money">${dollars(data.totals.taxEstimateCents)}</div>
          <div class="l">Est. Employer Tax ({data.totals.taxPct}%)</div>
        </div>
        <div class="stat" style="border-color:var(--primary);">
          <div class="n money" style="color:var(--primary);">${dollars(data.totals.allInEstimateCents)}</div>
          <div class="l">All-In Estimate</div>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem;">
        <span class="badge">Adjusted wages (w/ OT): ${dollars(data.totals.adjustedWageCents)}</span>
        <span class="badge" style="color:var(--success);border-color:var(--success);">
          Declared cash tips: ${dollars(data.totals.declaredCashTipsCents)}
        </span>
        <span class="badge">{data.totals.shiftCount} shifts • {data.totals.businessDates.length} days</span>
      </div>

      {#if data.totals.salariedStaff.length > 0}
        <details style="margin-top:0.75rem;">
          <summary style="font-size:0.8rem;color:var(--muted);cursor:pointer;">
            Salaried staff ({data.totals.salariedStaff.length}) — ${dollars(data.totals.salaryDailyCents)}/day combined
          </summary>
          {#each data.totals.salariedStaff as s}
            <div style="display:flex;justify-content:space-between;font-size:0.8rem;padding:0.3rem 0;border-bottom:1px solid var(--border);">
              <span>{s.name}</span>
              <span class="money">${dollars(s.annualCents)}/yr{s.weeklyHours ? ` • ${s.weeklyHours}h/wk` : ''}</span>
            </div>
          {/each}
        </details>
      {/if}
      {#if data.totals.provisionalWageCents > 0}
        <p style="font-size:0.7rem;color:var(--muted);margin-top:0.5rem;">
          Includes ${dollars(data.totals.provisionalWageCents)} from open shifts.
        </p>
      {/if}
    </div>

    <!-- Employer tax % -->
    <div class="card">
      <p class="label">Employer Tax Burden</p>
      <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">
        Applied on top of wages + salary. Enter your real burden % (FICA, FUTA/SUTA, WA L&amp;I, PFML) —
        replace with actuals by dropping the payroll report below.
      </p>
      <form method="POST" action="?/saveTax" use:enhance={taxEnhance} style="display:flex;gap:0.5rem;align-items:center;">
        <input class="input" type="number" name="labor_employer_tax_pct" step="0.1" min="0" max="100"
          value={data.totals.taxPct} style="width:110px;" />
        <span style="font-size:1.2rem;color:var(--muted);">%</span>
        <button type="submit" class="btn btn-secondary" disabled={savingTax}
          style="width:auto;font-size:0.85rem;padding:0.6rem 1rem;">
          {savingTax ? 'Saving…' : 'Save'}
        </button>
      </form>
      {#if form?.taxSaved}<p class="success-msg" style="margin-top:0.5rem;">Tax rate saved.</p>{/if}
      {#if form?.taxError}<p class="error-msg" style="margin-top:0.5rem;">{form.taxError}</p>{/if}
    </div>

    <!-- Per-day breakdown -->
    {#if data.byDay.length > 0}
      <div class="card">
        <p class="label">By Business Day</p>
        {#each data.byDay as d}
          <div class="dayrow">
            <span class="day-date money">{d.businessDate}</span>
            <span>{hm(d.hoursMinutes)} h</span>
            <span class="money">${dollars(d.wageCents)}{d.provisional ? '~' : ''}</span>
            {#if d.declaredCashTipsCents > 0}
              <span style="color:var(--success);" class="money">+${dollars(d.declaredCashTipsCents)} tips</span>
            {/if}
            <span style="color:var(--muted);font-size:0.7rem;">{d.shiftCount} shifts</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Per-person -->
    {#if data.byPerson.length > 0}
      <div class="card">
        <p class="label">By Person</p>
        {#each data.byPerson as p}
          <div class="dayrow">
            <span class="pname">
              {p.name}
              {#if p.payType === 'SALARY'}<span class="badge" style="margin-left:0.3rem;">SALARY</span>{/if}
              {#if p.provisional}<span class="badge" style="color:var(--primary);border-color:var(--primary);margin-left:0.3rem;">OPEN</span>{/if}
            </span>
            <span>{hm(p.hoursMinutes)} h</span>
            <span class="money">${dollars(p.wageCents)}</span>
            {#if p.otMinutes > 0}
              <span style="color:var(--primary);" class="money">+${dollars(p.otPremiumCents)} OT ({hm(p.otMinutes)})</span>
            {/if}
            {#if p.declaredCashTipsCents > 0}
              <span style="color:var(--success);" class="money">+${dollars(p.declaredCashTipsCents)} tips</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- File drop-zone -->
    <div class="card">
      <p class="label">Drop Payroll / Bank / Tax Files</p>
      <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;line-height:1.5;">
        Drag a payroll register, bank-transaction CSV, or IRS/state filing export here —
        whatever holds your <strong>actual</strong> taxes and net-pay. Stored securely
        server-side (gitignored). Once you drop the first real file, its format gets a
        dedicated parser and these actuals replace the estimates above.
      </p>
      <form method="POST" action="?/upload" use:enhance={uploadEnhance} enctype="multipart/form-data">
        <input class="input" type="file" name="file" accept=".csv,.txt,.xlsx,.xls,.qbo,.json"
          style="padding:0.5rem;font-size:0.9rem;" required />
        <button type="submit" class="btn btn-secondary" disabled={uploading} style="margin-top:0.5rem;">
          {uploading ? 'Uploading…' : 'Upload File'}
        </button>
      </form>
      {#if form?.uploaded}
        <p class="success-msg" style="margin-top:0.5rem;">
          Uploaded “{form.uploaded}” — detected as {IMPORT_KIND_LABEL[form.uploadKind] ?? form.uploadKind}.
        </p>
      {/if}
      {#if form?.uploadError}
        <p class="error-msg" style="margin-top:0.5rem;">{form.uploadError}</p>
      {/if}

      {#if data.imports.length > 0}
        <div style="margin-top:0.75rem;">
          <p style="font-size:0.8rem;font-weight:600;">Uploaded files:</p>
          {#each data.imports as imp}
            <div class="dayrow">
              <span class="pname">{imp.filename}</span>
              <span class="badge">{IMPORT_KIND_LABEL[imp.kind] ?? imp.kind}</span>
              <span class="badge" style="color:var(--primary);border-color:var(--primary);">{imp.status}</span>
              <span style="color:var(--muted);font-size:0.7rem;">
                {imp.size_bytes > 1048576 ? `${(imp.size_bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(imp.size_bytes / 1024))}KB`}
                • {imp.uploaded_at.slice(0, 16).replace('T', ' ')}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

  </div>
</div>

<style>
  .dayrow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
    flex-wrap: wrap;
  }
  .dayrow:last-child { border-bottom: none; }
  .day-date { font-weight: 600; }
  .pname { font-weight: 600; flex: 1 1 140px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .stats .stat .n { font-size: 1.05rem; }
</style>
