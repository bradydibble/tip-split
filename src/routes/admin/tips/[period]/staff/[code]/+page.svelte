<script lang="ts">
  import type { PageData } from './$types';
  import { formatCents } from '$lib/calculator';

  let { data }: { data: PageData } = $props();

  const d = $derived(data.detail);

  function breakdown(r: {
    foh_share_cents: number;
    bar_pool_share_cents: number;
    kitchen_share_cents: number;
    busser_share_cents: number;
  }): string {
    const parts: string[] = [];
    if (r.foh_share_cents > 0) parts.push(`FOH ${formatCents(r.foh_share_cents)}`);
    if (r.bar_pool_share_cents > 0) parts.push(`Bar ${formatCents(r.bar_pool_share_cents)}`);
    if (r.kitchen_share_cents > 0) parts.push(`Kitchen ${formatCents(r.kitchen_share_cents)}`);
    if (r.busser_share_cents > 0) parts.push(`Busser ${formatCents(r.busser_share_cents)}`);
    return parts.join(' · ');
  }

  function shiftLabel(date: string, shift: string): string {
    const [y, m, dd] = date.split('-').map(Number);
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, dd)));
    return `${day} · ${shift}`;
  }
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/admin/tips/{data.periodStart}" class="nav-back" aria-label="Back">←</a>
    <h2>{d.staff.name}</h2>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Identity -->
    <div class="card">
      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
        <span style="font-size:1.15rem;font-weight:700;">{d.staff.name}</span>
        {#if d.staff.staff_code}<span class="badge">{d.staff.staff_code}</span>{/if}
        <span class="badge">{d.staff.role}</span>
        {#if !d.staff.active}<span class="badge">Inactive</span>{/if}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.5rem;">
        <span style="font-size:0.8rem;color:var(--muted);">
          {data.label}
          {#if data.status === 'current'}(current){:else if data.status === 'upcoming'}(upcoming){:else}(past){/if}
        </span>
        <a href="/admin/tips/{data.periodStart}/staff/{d.staff.staff_code}{data.includeVoided ? '' : '?v=1'}"
           style="font-size:0.75rem;color:var(--muted);">
          {data.includeVoided ? 'Hiding voided' : 'Include voided'}
        </a>
      </div>
      <p style="font-size:1.5rem;font-weight:800;color:var(--primary);margin-top:0.75rem;" class="money">
        {formatCents(d.totalCents)}
      </p>
      <p style="font-size:0.75rem;color:var(--muted);">
        Period total · {d.shifts.length} shift{d.shifts.length === 1 ? '' : 's'}
      </p>
    </div>

    <!-- Shifts -->
    <div class="card" style="padding-top:0.5rem;padding-bottom:0.5rem;">
      {#if d.shifts.length === 0}
        <p style="color:var(--muted);font-size:0.875rem;padding:1rem 0;text-align:center;">
          No shifts in this period.
        </p>
      {:else}
        {#each d.shifts as r}
          <div class="table-row" style="cursor:default;">
            <div class="row-top">
              <span class="who"><span class="nm">{shiftLabel(r.date, r.shift)}</span></span>
              <span class="amt">{formatCents(r.total_cents)}</span>
            </div>
            <div class="row-sub">
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                {breakdown(r) || '—'}
              </span>
              {#if r.recorded_name !== d.staff.name}
                <span title="Name as recorded on the shift">as “{r.recorded_name}”</span>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
