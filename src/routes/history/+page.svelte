<script lang="ts">
  import type { PageData } from './$types';
  import { formatCents } from '$lib/calculator';

  let { data }: { data: PageData } = $props();
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/calculate" class="nav-back" aria-label="Back">←</a>
    <h2>History</h2>
  </nav>

  <div style="padding:1rem 0;">
    {#if data.calcs.length === 0}
      <div class="card" style="text-align:center;padding:2rem;">
        <p style="color:var(--muted);">No calculations yet.</p>
      </div>
    {:else}
      {#each data.calcs as c}
        <a href="/calculate/{c.id}" style="display:block;text-decoration:none;margin-bottom:0.75rem;">
          <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;">
            <div>
              <div style="font-weight:600;">{c.date}</div>
              <div style="font-size:0.875rem;color:var(--muted);">{c.shift} · {c.staff_count} staff</div>
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
