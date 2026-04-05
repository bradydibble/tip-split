<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let adding = $state(false);
  let newName = $state('');
  let newRole = $state<'FOH' | 'Kitchen' | 'Bar'>('FOH');
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/settings" class="nav-back" aria-label="Back">←</a>
    <h2>Staff Roster</h2>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Add staff -->
    <div class="card">
      <p class="label">Add Staff Member</p>
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
          </select>
        </div>
        {#if form && 'addError' in form}<p class="error-msg">{(form as {addError: string}).addError}</p>{/if}
        <button type="submit" class="btn btn-primary" disabled={adding || !newName.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>
    </div>

    <!-- Existing staff -->
    {#each [['FOH', 'FOH / Server'], ['Bar', 'Bar / Bartender'], ['Kitchen', 'Kitchen']] as [role, label]}
      {@const group = data.staff.filter(s => s.role === role)}
      {#if group.length > 0}
        <div class="card">
          <p class="label">{label}</p>
          {#each group as person}
            <div style="display:flex;justify-content:space-between;align-items:center;
                        padding:0.6rem 0;border-bottom:1px solid var(--border);">
              <span style="font-size:1rem;{!person.active ? 'color:var(--muted);text-decoration:line-through;' : ''}">{person.name}</span>
              <div style="display:flex;gap:0.5rem;">
                <form method="POST" action="?/toggle" use:enhance>
                  <input type="hidden" name="id" value={person.id} />
                  <button type="submit" style="background:none;font-size:0.75rem;
                    color:{person.active ? 'var(--muted)' : 'var(--success)'};">
                    {person.active ? 'Deactivate' : 'Activate'}
                  </button>
                </form>
                <form method="POST" action="?/remove" use:enhance>
                  <input type="hidden" name="id" value={person.id} />
                  <button type="submit" style="background:none;font-size:0.75rem;color:var(--danger);">
                    Remove
                  </button>
                </form>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/each}

    {#if data.staff.length === 0}
      <div class="card" style="text-align:center;padding:2rem;">
        <p style="color:var(--muted);">No staff yet. Add someone above.</p>
      </div>
    {/if}
  </div>
</div>
