<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { formatCents } from '$lib/calculator';
  import { formatPeriodLabel, periodStatus } from '$lib/pay-period';

  let { data }: { data: PageData } = $props();

  let showSheet = $state(false);

  const includeVoided = $derived(page.url.searchParams.get('v') === '1');
  const voidParamUrl = $derived(
    `/admin/tips/${data.periodStart}${includeVoided ? '' : '?v=1'}`,
  );
  // Preserve the voided toggle when navigating to other periods/rows/CSV.
  const vq = $derived(includeVoided ? '?v=1' : '');

  const statusLabel = $derived(
    data.status === 'current' ? 'Current' : data.status === 'upcoming' ? 'Upcoming' : 'Past',
  );
</script>

<div class="page" style="padding-top:0;padding-bottom:6rem;">
  <nav class="nav">
    <a href="/settings" class="nav-back" aria-label="Back">←</a>
    <h2>Pay Period Tips</h2>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Period nav -->
    <div class="period-nav">
      <button
        type="button"
        disabled={!data.prev}
        onclick={() => data.prev && (window.location.href = `/admin/tips/${data.prev}${vq}`)}
        aria-label="Previous period">‹</button>
      <button
        type="button"
        class="period-label"
        onclick={() => showSheet = true}
        aria-haspopup="dialog"
        aria-label="Choose period">
        <span class="t">{data.label}</span>
        <span class="s">
          {data.index + 1} of {data.range.length}
          {#if data.dayOfPeriod} · day {data.dayOfPeriod} of {data.periodLength}{/if}
        </span>
      </button>
      <button
        type="button"
        disabled={!data.next}
        onclick={() => data.next && (window.location.href = `/admin/tips/${data.next}${vq}`)}
        aria-label="Next period">›</button>
    </div>

    <!-- Status + stats -->
    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
        <span class="badge {data.status === 'current' ? 'badge-current' : data.status === 'upcoming' ? 'badge-upcoming' : ''}">
          {statusLabel}
        </span>
        <a href={voidParamUrl} style="font-size:0.75rem;color:var(--muted);">
          {includeVoided ? 'Hiding voided' : 'Include voided'}
        </a>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="n">{data.report.shiftsCount}</div>
          <div class="l">Shifts</div>
        </div>
        <div class="stat">
          <div class="n">{data.report.staffPaidCount}</div>
          <div class="l">Staff paid</div>
        </div>
        <div class="stat">
          <div class="n">{data.report.activeStaffCount}</div>
          <div class="l">Active staff</div>
        </div>
      </div>
      {#if data.report.voidedExcludedCount > 0}
        <p style="font-size:0.75rem;color:var(--muted);margin-top:0.75rem;">
          {data.report.voidedExcludedCount} voided calculation{data.report.voidedExcludedCount === 1 ? '' : 's'} {includeVoided ? 'included' : 'excluded'}
        </p>
      {/if}
      {#if data.report.unlinkedCount > 0}
        <p style="font-size:0.75rem;color:var(--danger);margin-top:0.5rem;">
          {data.report.unlinkedCount} unlinked distribution row{data.report.unlinkedCount === 1 ? '' : 's'}
          ({formatCents(data.report.unlinkedCents)}) in grand total only
        </p>
      {/if}
    </div>

    <!-- Per-staff rows -->
    <div class="card" style="padding-top:0.5rem;padding-bottom:0.5rem;">
      {#if data.report.rows.length === 0}
        <p style="color:var(--muted);font-size:0.875rem;padding:1rem 0;text-align:center;">
          No tips recorded for this period yet.
        </p>
      {:else}
        {#each data.report.rows as r}
          <a class="table-row" href="/admin/tips/{data.periodStart}/staff/{r.staff_code ?? r.staff_id}{vq}">
            <div class="row-top">
              <span class="who">
                <span class="nm">{r.name}</span>
                {#if r.staff_code}<span class="badge">{r.staff_code}</span>{/if}
              </span>
              <span class="amt">{formatCents(r.total_cents)}</span>
            </div>
            <div class="row-sub">
              <span>{r.role}</span>
              <span>{r.shifts} shift{r.shifts === 1 ? '' : 's'}</span>
            </div>
          </a>
        {/each}
      {/if}
      {#if data.report.rows.length > 0}
        <p style="font-size:0.75rem;color:var(--muted);padding:0.6rem 0 0.25rem;">
          {data.report.staffPaidCount} of {data.report.activeStaffCount} active staff have tips this period
        </p>
      {/if}
    </div>
  </div>

  <!-- Sticky footer: grand total + CSV -->
  <div class="report-footer">
    <span class="grand">
      <span class="l">Period total</span>
      {formatCents(data.report.grandTotalCents)}
    </span>
    <a class="btn btn-secondary" style="width:auto;padding:0.6rem 1rem;font-size:0.9rem;"
        href="/admin/tips/{data.periodStart}/export.csv{vq}">
      CSV
    </a>
  </div>

  <!-- Period picker sheet -->
  {#if showSheet}
    <!-- Backdrop: a labeled, focusable dismiss layer. Placed BEFORE the
         panel (sibling, not ancestor) so the panel may freely contain
         interactive elements (buttons, links). -->
    <button type="button" aria-label="Close chooser"
      style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:50;border:none;cursor:default;display:block;padding:0;"
      onclick={() => showSheet = false}></button>
    <div role="dialog" aria-modal="true" aria-label="Choose pay period"
         style="position:fixed;bottom:0;left:50%;transform:translateX(-50%);
                width:100%;max-width:480px;max-height:75dvh;overflow-y:auto;
                background:var(--surface);border-radius:16px 16px 0 0;z-index:51;
                padding:1rem 1rem calc(1rem + env(safe-area-inset-bottom));">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
        <strong>Choose period</strong>
        <button type="button" style="background:none;color:var(--muted);font-size:1.25rem;padding:0.25rem;"
          onclick={() => showSheet = false} aria-label="Close">✕</button>
      </div>
      {#each data.range as s, i}
        {@const st = periodStatus(s, data.today)}
        <a href="/admin/tips/{s}{vq}" style="display:flex;justify-content:space-between;align-items:center;
           padding:0.7rem 0.5rem;border-bottom:1px solid var(--border);border-radius:8px;
           {i === data.index ? 'background:var(--row-active);' : ''}">
          <span style="font-size:0.9rem;font-weight:{i === data.index ? 700 : 400};">
            {formatPeriodLabel(s)}
            {#if st === 'current'}<span class="badge badge-current" style="margin-left:0.4rem;">Current</span>{/if}
          </span>
          <span class="money" style="font-size:0.9rem;color:var(--muted);">
            {formatCents(data.totals[s] ?? 0)}
          </span>
        </a>
      {/each}
    </div>
  {/if}
</div>
