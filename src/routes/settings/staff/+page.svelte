<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  import type { StaffRow } from '$lib/server/db';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let adding = $state(false);
  let newName = $state('');
  let newRole = $state<'FOH' | 'Kitchen' | 'Bar' | 'Busser'>('FOH');
  let editingId = $state<number | null>(null);
  let editName = $state('');
  let editRole = $state('');

  function startEdit(person: { id: number; name: string; role: string }) {
    editingId = person.id;
    editName = person.name;
    editRole = person.role;
  }

  function parseRecords(records: string): { id: number; name: string }[] {
    return records.split(', ').map(r => {
      const parts = r.split(':');
      return { id: parseInt(parts[0]), name: parts[1] };
    });
  }

  // Cast helper for accessing extended staff columns (square_job_titles, role_mapping_state, etc.)
  type StaffWithSquare = StaffRow & {
    square_job_titles: string | null;
    role_mapping_state: string | null;
    default_tip_split_role: string | null;
    square_team_member_id: string | null;
  };

  function sqJobs(s: StaffRow): string | null {
    return (s as StaffWithSquare).square_job_titles;
  }
  function sqId(s: StaffRow): string | null {
    return (s as StaffWithSquare).square_team_member_id;
  }
  function mappingState(s: StaffRow): string | null {
    return (s as StaffWithSquare).role_mapping_state;
  }
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/settings" class="nav-back" aria-label="Back">←</a>
    <h2>Staff Roster</h2>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Add staff -->
    <div class="card">
      <p class="label">Add Staff Member (Manual)</p>
      <form method="POST" action="?/add" use:enhance={() => {
        adding = true;
        return ({ update }) => { adding = false; newName = ''; update(); };
      }}>
        <div style="display:grid;grid-template-columns:1fr auto;gap:0.75rem;margin-bottom:0.75rem;">
          <input class="input" type="text" name="name" bind:value={newName}
            placeholder="Staff member name" required />
          <select class="input" name="role" bind:value={newRole}
            style="width:auto;padding-right:2rem;">
            <option>FOH</option>
            <option>Bar</option>
            <option>Kitchen</option>
            <option>Busser</option>
          </select>
        </div>
        {#if form && 'addError' in form}<p class="error-msg">{(form as {addError: string}).addError}</p>{/if}
        <button type="submit" class="btn btn-primary" disabled={adding || !newName.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>
    </div>

    <!-- Duplicates warning -->
    {#if data.duplicates && data.duplicates.length > 0}
      <div class="card" style="border-color:var(--danger);">
        <p class="label" style="color:var(--danger);">Duplicate Square IDs Detected</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
          These staff records share the same Square Team Member ID. Choose which one to keep.
        </p>
        {#each data.duplicates as dupe}
          {@const records = parseRecords(dupe.records)}
          <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);">
            <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.25rem;">
              Square ID: {dupe.square_team_member_id.slice(0, 20)}…
            </div>
            {#each records as rec}
              <form method="POST" action="?/resolveDupe" use:enhance style="display:inline-block;margin-right:0.5rem;">
                <input type="hidden" name="keep_id" value={rec.id} />
                <input type="hidden" name="remove_id" value={records[0].id === rec.id ? records[1].id : records[0].id} />
                <button type="submit" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:0.3rem 0.6rem;font-size:0.8rem;">
                  Keep {rec.name} (#{rec.id})
                </button>
              </form>
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Needs review -->
    {#if data.staff.filter(s => mappingState(s) === 'NEEDS_REVIEW' && s.active === 1).length > 0}
      {@const review = data.staff.filter(s => mappingState(s) === 'NEEDS_REVIEW' && s.active === 1)}
      <div class="card" style="border:1px solid var(--primary);">
        <p class="label" style="color:var(--primary);">Needs Role Review (Square)</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
          These staff have conflicting Square job titles. Their Square jobs are shown — assign a TipSplit role.
        </p>
        {#each review as person}
          <div style="padding:0.6rem 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.35rem;flex-wrap:wrap;">
              <span style="font-size:1rem;font-weight:600;">{person.name}</span>
              {#if sqJobs(person)}<span class="badge" style="color:var(--muted);">{sqJobs(person)}</span>{/if}
            </div>
            <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.35rem;">
              Square ID: {sqId(person) ?? '(none)'}
            </div>
            <form method="POST" action="?/changeRole" use:enhance
              style="display:flex;align-items:center;gap:0.5rem;">
              <input type="hidden" name="id" value={person.id} />
              <span style="font-size:0.75rem;color:var(--muted);">Assign role:</span>
              <select name="role" class="input"
                style="font-size:0.75rem;padding:0.2rem 0.5rem;width:auto;height:auto;">
                {#each ['FOH', 'Bar', 'Kitchen', 'Busser'] as r}
                  <option value={r}>{r}</option>
                {/each}
              </select>
              <button type="submit"
                style="background:var(--primary);font-size:0.75rem;font-weight:600;color:#000;padding:0.2rem 0.6rem;border-radius:6px;">
                Confirm
              </button>
            </form>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Existing staff by role -->
    {#each [['FOH', 'FOH / Server'], ['Bar', 'Bar / Bartender'], ['Kitchen', 'Kitchen'], ['Busser', 'Busser']] as [role, label]}
      {@const group = data.staff.filter(s => s.role === role && mappingState(s) !== 'EXCLUDED')}
      {#if group.length > 0}
        <div class="card">
          <p class="label">{label} ({group.length})</p>
          {#each group as person}
            <div style="padding:0.6rem 0;border-bottom:1px solid var(--border);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;min-width:0;">
                  <span style="font-size:1rem;{!person.active ? 'color:var(--muted);text-decoration:line-through;' : ''}">{person.name}</span>
                  {#if sqJobs(person)}
                    <span class="badge" style="font-size:0.65rem;color:var(--muted);" title="Square job titles">{sqJobs(person)}</span>
                  {/if}
                </div>
                <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0;">
                  <form method="POST" action="?/toggle" use:enhance>
                    <input type="hidden" name="id" value={person.id} />
                    <button type="submit" style="background:none;font-size:0.75rem;
                      color:{person.active ? 'var(--muted)' : 'var(--success)'};">
                      {person.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </form>
                  <button onclick={() => startEdit(person)} style="background:none;font-size:0.75rem;color:var(--primary);">
                    Edit
                  </button>
                </div>
              </div>

              <!-- Square UUID and details -->
              <div style="font-size:0.7rem;color:var(--muted);margin-top:0.15rem;">
                {sqId(person) ? `Square: ${sqId(person)}` : 'Manual entry'}
                {#if person.staff_code} • {person.staff_code}{/if}
              </div>

              <!-- Inline edit form -->
              {#if editingId === person.id}
                <form method="POST" action="?/edit" use:enhance={() => { editingId = null; return ({ update }) => update(); }}
                  style="margin-top:0.35rem;display:flex;gap:0.5rem;align-items:center;">
                  <input type="hidden" name="id" value={person.id} />
                  <input class="input" type="text" name="name" value={editName}
                    style="flex:1;font-size:0.85rem;" />
                  <select name="role" class="input" style="width:auto;font-size:0.85rem;padding:0.3rem;">
                    {#each ['FOH', 'Bar', 'Kitchen', 'Busser'] as r}
                      <option value={r} selected={editRole === r}>{r}</option>
                    {/each}
                  </select>
                  <button type="submit" style="background:var(--success);color:#000;font-size:0.75rem;font-weight:600;padding:0.3rem 0.6rem;border-radius:6px;">
                    Save
                  </button>
                  <button type="button" onclick={() => editingId = null}
                    style="background:none;font-size:0.75rem;color:var(--muted);">
                    Cancel
                  </button>
                </form>
              {/if}

              <!-- Role change dropdown (when not editing) -->
              {#if editingId !== person.id}
                <form method="POST" action="?/changeRole" use:enhance
                  style="margin-top:0.35rem;display:flex;align-items:center;gap:0.5rem;">
                  <input type="hidden" name="id" value={person.id} />
                  <span style="font-size:0.75rem;color:var(--muted);">Role:</span>
                  <select name="role" class="input"
                    style="font-size:0.75rem;padding:0.2rem 0.5rem;width:auto;height:auto;">
                    {#each ['FOH', 'Bar', 'Kitchen', 'Busser'] as r}
                      <option value={r} selected={person.role === r}>{r}</option>
                    {/each}
                  </select>
                  <button type="submit"
                    style="background:none;font-size:0.75rem;font-weight:600;color:var(--primary);">
                    Change
                  </button>
                </form>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/each}

    <!-- Excluded staff -->
    {#if data.staff.filter(s => mappingState(s) === 'EXCLUDED' && s.active === 1).length > 0}
      {@const excl = data.staff.filter(s => mappingState(s) === 'EXCLUDED' && s.active === 1)}
      <div class="card">
        <details>
          <summary style="font-size:0.85rem;font-weight:600;color:var(--danger);cursor:pointer;">
            Excluded ({excl.length}) — managers/owners, not in tip pools
          </summary>
          {#each excl as person}
            <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                  <span style="color:var(--muted);">{person.name}</span>
                  {#if sqJobs(person)}<span class="badge" style="font-size:0.65rem;">{sqJobs(person)}</span>{/if}
                </div>
                <form method="POST" action="?/setExclusion" use:enhance>
                  <input type="hidden" name="id" value={person.id} />
                  <input type="hidden" name="exclude" value="false" />
                  <button type="submit" style="background:none;font-size:0.75rem;color:var(--success);">
                    Include
                  </button>
                </form>
              </div>
              <div style="font-size:0.7rem;color:var(--muted);margin-top:0.15rem;">
                {sqId(person) ? `Square: ${sqId(person)}` : 'Manual'}
              </div>
            </div>
          {/each}
        </details>
      </div>
    {/if}

    <!-- Individual exclude action for mapped staff -->
    {#if data.staff.filter(s => mappingState(s) !== 'EXCLUDED' && mappingState(s) !== 'NEEDS_REVIEW' && s.active === 1 && s.source === 'square').length > 0}
      <div class="card">
        <p class="label">Individually Exclude Someone</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">
          Override: exclude a specific person from tip splits regardless of their job title.
        </p>
        <form method="POST" action="?/setExclusion" use:enhance style="display:flex;gap:0.5rem;align-items:center;">
          <select name="id" class="input" style="flex:1;font-size:0.85rem;">
            <option value="">Select staff member…</option>
            {#each data.staff.filter(s => mappingState(s) !== 'EXCLUDED' && mappingState(s) !== 'NEEDS_REVIEW' && s.active === 1 && s.source === 'square') as person}
              <option value={person.id}>{person.name} ({person.role})</option>
            {/each}
          </select>
          <input type="hidden" name="exclude" value="true" />
          <button type="submit" class="btn btn-danger" style="font-size:0.85rem;width:auto;padding:0.5rem 1rem;">
            Exclude
          </button>
        </form>
      </div>
    {/if}

    <!-- Remove (no history only) -->
    <div class="card">
      <p class="label">Inactive / Removable</p>
      {#each data.staff.filter(s => s.active === 0) as person}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--muted);text-decoration:line-through;">{person.name}</span>
          <div style="display:flex;gap:0.5rem;">
            <form method="POST" action="?/toggle" use:enhance>
              <input type="hidden" name="id" value={person.id} />
              <button type="submit" style="background:none;font-size:0.75rem;color:var(--success);">Reactivate</button>
            </form>
            <form method="POST" action="?/remove" use:enhance>
              <input type="hidden" name="id" value={person.id} />
              <button type="submit" style="background:none;font-size:0.75rem;color:var(--danger);">Delete</button>
            </form>
          </div>
        </div>
      {/each}
      {#if data.staff.filter(s => s.active === 0).length === 0}
        <p style="font-size:0.8rem;color:var(--muted);">No inactive staff.</p>
      {/if}
    </div>

  </div>
</div>
