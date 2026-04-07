<script lang="ts">
  import type { PageData } from './$types';
  import { formatCents } from '$lib/calculator';

  let { data }: { data: PageData } = $props();
  let showVoided = $state(false);

  const visible = $derived(showVoided ? data.calcs : data.calcs.filter(c => !c.voided));
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/calculate" class="nav-back" aria-label="Back">←</a>
    <h2>History</h2>
    <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:var(--muted);cursor:pointer;">
      <input type="checkbox" bind:checked={showVoided} style="accent-color:var(--primary);" />
      Show voided
    </label>
  </nav>

  <div style="padding:1rem 0;">
    {#if visible.length === 0}
      <div class="card" style="text-align:center;padding:2rem;">
        <p style="color:var(--muted);">No calculations yet.</p>
      </div>
    {:else}
      {#each visible as c}
        <a href="/calculate/{c.id}" style="display:block;text-decoration:none;margin-bottom:0.75rem;
          opacity:{c.voided ? '0.5' : '1'};">
          <div class="card" style="display:flex;justify-content:space-between;align-items:center;
            margin-bottom:0;{c.voided ? 'border:1.5px solid var(--border);' : ''}">
            <div>
              <div style="font-weight:600;{c.voided ? 'text-decoration:line-through;' : ''}">{c.date}</div>
              <div style="font-size:0.875rem;color:var(--muted);">
                {c.shift} · {c.staff_count} staff
                {#if c.voided}<span style="color:var(--danger);margin-left:0.4rem;">VOID</span>{/if}
              </div>
            </div>
            <div style="text-align:right;">
              <div class="money" style="font-size:1.1rem;font-weight:700;color:var(--primary);">
                ${formatCents(c.tips_after_fees_cents)}
              </div>
              <div style="font-size:0.75rem;color:var(--muted);">after fees</div>
            </div>
          </div>
        </a>
      {/each}
    {/if}
  </div>
</div>
