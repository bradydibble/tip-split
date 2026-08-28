<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  import type { StaffRow } from '$lib/server/db';
  import { roleFieldName, STAFF_ROLES, type StaffRole } from '$lib/staff-role-selection';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let loading = $state(false);
  let shift = $state(data.defaultShift);
  let date = $state(data.today);

  const SHIFTS = ['Lunch', 'Dinner'] as const;

  // Live staff list — starts from server data, updated when new person is added
  let staff = $state<StaffRow[]>(data.staff);

  // Staff checked state — all active staff included by default
  let included = $state<Set<number>>(new Set());

  // Per-shift effective role for each selected staff (defaults to the
  // staff's roster role). The server validates the submitted enum again.
  let staffEffectiveRoles = $state<Map<number, StaffRole>>(new Map());

  function setRole(id: number, role: StaffRole) {
    const next = new Map(staffEffectiveRoles);
    next.set(id, role);
    staffEffectiveRoles = next;
  }

  function toggleStaff(id: number) {
    const nextSet = new Set(included);
    if (nextSet.has(id)) {
      nextSet.delete(id);
      const nextMap = new Map(staffEffectiveRoles);
      nextMap.delete(id);
      staffEffectiveRoles = nextMap;
    } else {
      nextSet.add(id);
      const nextMap = new Map(staffEffectiveRoles);
      const person = staff.find(s => s.id === id);
      if (person && !nextMap.has(id)) nextMap.set(id, person.role);
      staffEffectiveRoles = nextMap;
    }
    included = nextSet;
  }

  function selectAll() {
    const nextSet = new Set<number>();
    const nextMap = new Map<number, StaffRole>();
    for (const s of staff) { nextSet.add(s.id); nextMap.set(s.id, s.role); }
    included = nextSet;
    staffEffectiveRoles = nextMap;
  }

  function deselectAll() {
    included = new Set();
    staffEffectiveRoles = new Map();
  }

  // Quick-add staff
  let showAddForm = $state(false);
  let addingStaff = $state(false);
  let newName = $state('');
  let newRole = $state<StaffRole>('FOH');
  let addError = $state('');

  // Detect duplicate names to show ID badges
  const nameCounts = $derived(
    staff.reduce((acc, s) => { acc[s.name] = (acc[s.name] ?? 0) + 1; return acc; }, {} as Record<string, number>)
  );

  type RoleGroup = { label: string; role: StaffRole };
  const ROLE_GROUPS: RoleGroup[] = [
    { label: 'FOH', role: 'FOH' },
    { label: 'Bar', role: 'Bar' },
    { label: 'Kitchen', role: 'Kitchen' },
    { label: 'Busser', role: 'Busser' },
  ];

  // Group staff by the role they will PERFORM THIS SHIFT — defaults to
  // their roster role until the user picks otherwise via the dropdown.
  // As the dropdown changes, the person visually moves to the new
  // role's section (live regroup).
  const effectiveRoleOf = (s: StaffRow): StaffRole =>
    staffEffectiveRoles.get(s.id) ?? s.role;

  const staffByRole = $derived(
    Object.fromEntries(
      ROLE_GROUPS.map(g => [g.role, staff.filter(s => effectiveRoleOf(s) === g.role)])
    ) as Record<'FOH' | 'Bar' | 'Kitchen' | 'Busser', StaffRow[]>
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
            {#each SHIFTS as s}
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
    <div class="card staff-card">
      <div class="staff-toolbar">
        <p class="label" style="margin:0;">Staff working this shift</p>
        {#if staff.length > 0}
          <div style="display:flex;gap:0.25rem;align-items:center;font-size:0.75rem;">
            <button type="button" onclick={selectAll}
              style="background:none;border:none;color:var(--primary);padding:0;cursor:pointer;font-size:0.75rem;">Select All</button>
            <span style="color:var(--muted);">·</span>
            <button type="button" onclick={deselectAll}
              style="background:none;border:none;color:var(--primary);padding:0;cursor:pointer;font-size:0.75rem;">Deselect All</button>
          </div>
        {/if}
        <button type="button" onclick={() => { showAddForm = !showAddForm; addError = ''; }}
          style="background:none;font-size:0.8rem;font-weight:600;color:var(--primary);padding:0.2rem 0.5rem;
                 border:1.5px solid var(--primary);border-radius:6px;">
          {showAddForm ? 'Cancel' : '+ Add Person'}
        </button>
      </div>

      {#if showAddForm}
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;">
          <form method="POST" action="?/addStaff" use:enhance={({ cancel }) => {
            if (!newName.trim()) { addError = 'Name is required'; cancel(); return; }
            addingStaff = true;
            addError = '';
            return async ({ result, update }) => {
              addingStaff = false;
              if (result.type === 'success' && result.data?.addedId) {
                const newPerson: StaffRow = {
                  id: result.data.addedId as number,
                  name: newName.trim(),
                  role: newRole,
                  active: 1,
                  location_id: 1,
                  source: 'manual',
                  square_team_member_id: null,
                  staff_code: null,
                };
                staff = [...staff, newPerson].sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
                const nextSet = new Set([...included, newPerson.id]);
                const nextMap = new Map(staffEffectiveRoles);
                nextMap.set(newPerson.id, newRole);
                included = nextSet;
                staffEffectiveRoles = nextMap;
                newName = '';
                showAddForm = false;
              } else if (result.type === 'failure') {
                addError = String(result.data?.addError ?? 'Failed to add staff member');
              } else {
                await update();
              }
            };
          }}>
            <p style="font-size:0.75rem;font-weight:600;color:var(--muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.05em;">New Staff Member</p>
            <div style="display:grid;grid-template-columns:1fr auto;gap:0.5rem;margin-bottom:0.5rem;">
              <input class="input" type="text" name="name" bind:value={newName}
                placeholder="Full name" style="font-size:0.9rem;" />
              <select class="input" name="role" bind:value={newRole}
                style="width:auto;padding-right:1.5rem;font-size:0.9rem;">
                <option value="FOH">FOH</option>
                <option value="Bar">Bar</option>
                <option value="Kitchen">Kitchen</option>
                <option value="Busser">Busser</option>
              </select>
            </div>
            {#if addError}<p class="error-msg" style="margin-bottom:0.5rem;">{addError}</p>{/if}
            <button type="submit" class="btn btn-primary" style="padding:0.5rem 1rem;font-size:0.875rem;"
              disabled={addingStaff || !newName.trim()}>
              {addingStaff ? 'Adding…' : 'Add & Include in This Shift'}
            </button>
          </form>
        </div>
      {/if}

      {#if staff.length === 0}
        <p style="color:var(--muted);font-size:0.875rem;">
          No staff yet. Use "+ Add Person" above to add someone.
        </p>
      {:else}
        <div class="role-groups">
          {#each ROLE_GROUPS as { label, role }}
            {#if staffByRole[role].length > 0}
              <section class="role-group" data-role={role}>
                <div class="role-group-header">
                  <h3>{label}</h3>
                  <span class="role-count">{staffByRole[role].length}</span>
                </div>
                <div class="role-list">
                  {#each staffByRole[role] as person (person.id)}
                    {@const checked = included.has(person.id)}
                    <div class:staff-row-included={checked} class="staff-row">
                      <label class="staff-identity">
                        <input type="checkbox" name="included" value={person.id}
                          checked={checked} onchange={() => toggleStaff(person.id)}
                          aria-label={`Include ${person.name}`}/>
                        <span class="staff-name">{person.name}</span>
                        {#if nameCounts[person.name] > 1 && person.staff_code}
                          <span class="badge">{person.staff_code}</span>
                        {/if}
                      </label>
                      <select class="role-selector"
                        aria-label={`Role for ${person.name}`}
                        value={staffEffectiveRoles.get(person.id) ?? person.role}
                        onchange={(e) => setRole(person.id, e.currentTarget.value as StaffRole)}>
                        {#each STAFF_ROLES as availableRole}
                          <option value={availableRole}>{availableRole}</option>
                        {/each}
                      </select>
                      {#if checked}
                        <input type="hidden" name={roleFieldName(person.id)}
                          value={staffEffectiveRoles.get(person.id) ?? person.role} />
                      {/if}
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
          {/each}
        </div>
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

<style>
  .staff-card {
    padding: 1rem;
  }

  .staff-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.65rem 0.85rem;
    margin-bottom: 1rem;
  }

  .role-groups {
    display: grid;
    gap: 1rem;
  }

  .role-group {
    --role-accent: var(--primary);
    overflow: hidden;
    border: 1px solid var(--border);
    border-left: 4px solid var(--role-accent);
    border-radius: 10px;
    background: var(--surface2);
  }

  .role-group[data-role='Bar'] { --role-accent: #38bdf8; }
  .role-group[data-role='Kitchen'] { --role-accent: #34d399; }
  .role-group[data-role='Busser'] { --role-accent: #c084fc; }

  .role-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 42px;
    padding: 0.65rem 0.75rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  .role-group-header h3 {
    color: var(--text);
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.015em;
  }

  .role-count {
    display: grid;
    place-items: center;
    min-width: 1.65rem;
    height: 1.65rem;
    padding: 0 0.4rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--role-accent);
    background: var(--surface);
    font-size: 0.78rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .staff-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-height: 52px;
    padding: 0.55rem 0.65rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .staff-row:last-child {
    border-bottom: 0;
  }

  .staff-row-included {
    background: var(--surface2);
  }

  .staff-identity {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    flex: 1;
    cursor: pointer;
  }

  .staff-identity input {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    accent-color: var(--primary);
    cursor: pointer;
  }

  .staff-name {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 0.98rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .role-selector {
    width: 96px;
    flex: 0 0 auto;
    padding: 0.42rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text);
    background: var(--bg);
    font-size: 0.8rem;
    font-weight: 650;
  }

  .role-selector:focus-visible,
  .staff-identity input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  @media (max-width: 380px) {
    .staff-card { padding: 0.85rem; }
    .staff-row { padding-inline: 0.55rem; }
    .role-selector { width: 88px; font-size: 0.75rem; }
  }
</style>
