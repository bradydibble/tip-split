<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let loading = $state(false);
  let shift = $state(data.defaultShift);
  let date = $state(data.today);

  // Staff checked state — all active staff included by default
  let included = $state<Set<number>>(new Set(data.staff.map(s => s.id)));

  function toggleStaff(id: number) {
    const next = new Set(included);
    if (next.has(id)) next.delete(id); else next.add(id);
    included = next;
  }

  type RoleGroup = { label: string; role: 'FOH' | 'Bar' | 'Kitchen' };
  const ROLE_GROUPS: RoleGroup[] = [
    { label: 'FOH', role: 'FOH' },
    { label: 'Bar', role: 'Bar' },
    { label: 'Kitchen', role: 'Kitchen' },
  ];

  const staffByRole = $derived(
    Object.fromEntries(
      ROLE_GROUPS.map(g => [g.role, data.staff.filter(s => s.role === g.role)])
    ) as Record<'FOH' | 'Bar' | 'Kitchen', typeof data.staff>
  );
</script>

<div class="page">
  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 0 1.25rem;">
    <h1 style="font-size:1.5rem;font-weight:800;color:var(--primary);">TipSplit</h1>
    <div style="display:flex;gap:0.75rem;align-items:center;">
      <a href="/history" style="color:var(--muted);font-size:0.875rem;">History</a>
      {#if data.user?.role === 'manager'}
        <a href="/settings" style="color:var(--muted);font-size:0.875rem;">Settings</a>
      {/if}
      <form method="POST" action="/logout">
        <button type="submit" style="background:none;color:var(--muted);font-size:0.875rem;">Sign out</button>
      </form>
    </div>
  </div>

  <form method="POST" action="?/calculate" use:enhance={() => {
    loading = true;
    return ({ update }) => { loading = false; update(); };
  }}>

    <!-- Date + Shift -->
    <div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div>
          <label class="label" for="date">Date</label>
          <input id="date" name="date" type="date" class="input" bind:value={date} required />
        </div>
        <div>
          <label class="label">Shift</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
            {#each ['Lunch', 'Dinner'] as s}
              <button type="button"
                onclick={() => shift = s}
                style="
                  padding:0.75rem 0;border-radius:8px;font-weight:600;font-size:0.9rem;
                  background:{shift === s ? 'var(--primary)' : 'var(--bg)'};
                  color:{shift === s ? '#000' : 'var(--muted)'};
                  border:1.5px solid {shift === s ? 'var(--primary)' : 'var(--border)'};
                ">
                {s}
              </button>
            {/each}
          </div>
          <input type="hidden" name="shift" value={shift} />
        </div>
      </div>
    </div>

    <!-- Tip Amounts -->
    <div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div>
          <label class="label" for="gross_tips">Gross Tips</label>
          <div style="position:relative;">
            <span style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);color:var(--muted);">$</span>
            <input id="gross_tips" name="gross_tips" type="number" step="0.01" min="0"
              class="input" style="padding-left:1.75rem;" placeholder="0.00" required />
          </div>
        </div>
        <div>
          <label class="label" for="liquor_sales">Liquor Sales</label>
          <div style="position:relative;">
            <span style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);color:var(--muted);">$</span>
            <input id="liquor_sales" name="liquor_sales" type="number" step="0.01" min="0"
              class="input" style="padding-left:1.75rem;" placeholder="0.00" />
          </div>
        </div>
      </div>
    </div>

    <!-- Staff -->
    <div class="card">
      <p class="label">Staff Working This Shift</p>
      {#if data.staff.length === 0}
        <p style="color:var(--muted);font-size:0.875rem;">
          No staff yet. <a href="/settings/staff">Add staff in Settings.</a>
        </p>
      {:else}
        {#each ROLE_GROUPS as { label, role }}
          {#if staffByRole[role].length > 0}
            <p style="font-size:0.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;
                      letter-spacing:0.05em;margin:0.75rem 0 0.5rem;">{label}</p>
            {#each staffByRole[role] as person}
              {@const checked = included.has(person.id)}
              <label style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;
                            border-bottom:1px solid var(--border);cursor:pointer;">
                <input type="checkbox" name="included" value={person.id}
                  checked={checked} onchange={() => toggleStaff(person.id)}
                  style="width:20px;height:20px;accent-color:var(--primary);cursor:pointer;" />
                <span style="font-size:1rem;">{person.name}</span>
              </label>
            {/each}
          {/if}
        {/each}
      {/if}
    </div>

    {#if form?.error}
      <p class="error-msg">{form.error}</p>
    {/if}

    <button type="submit" class="btn btn-primary" disabled={loading || included.size === 0}>
      {loading ? 'Calculating…' : 'Calculate'}
    </button>
  </form>
</div>
