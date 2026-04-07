<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let adding = $state(false);
  let newPin = $state('');
  let newName = $state('');
  let newRole: 'shift_lead' | 'manager' = $state('shift_lead');
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/settings" class="nav-back" aria-label="Back">←</a>
    <h2>Users &amp; PINs</h2>
  </nav>

  <div style="padding:1rem 0;">
    <div class="card">
      <p style="font-size:0.875rem;color:var(--muted);margin-bottom:0.5rem;">
        PINs must be 4–6 digits and unique. Hand out PINs in person — they are not shown after creation.
      </p>
    </div>

    <!-- Add user -->
    <div class="card">
      <p class="label">Add User</p>
      <form method="POST" action="?/add" use:enhance={() => {
        adding = true;
        return ({ update }) => { adding = false; newPin = ''; newName = ''; update(); };
      }}>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem;">
          <input class="input" type="text" name="name" bind:value={newName}
            placeholder="Name" required />
          <input class="input" type="text" inputmode="numeric"
            name="pin" bind:value={newPin} placeholder="4–6 digit PIN" required />
        </div>
        <select class="input" name="role" bind:value={newRole} style="margin-bottom:0.75rem;">
          <option value="shift_lead">Shift Lead</option>
          <option value="manager">Manager</option>
        </select>
        {#if form && 'addError' in form}<p class="error-msg">{(form as {addError: string}).addError}</p>{/if}
        <button type="submit" class="btn btn-primary" disabled={adding || newPin.length < 4 || !newName.trim()}>
          {adding ? 'Adding…' : 'Add User'}
        </button>
      </form>
    </div>

    <!-- Existing users -->
    <div class="card">
      <p class="label">{data.users.length} User{data.users.length !== 1 ? 's' : ''}</p>
      {#each data.users as user}
        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:0.6rem 0;border-bottom:1px solid var(--border);">
          <div>
            <span style="font-weight:500;">{user.name ?? 'Unnamed'}</span>
            <span style="font-size:0.75rem;color:var(--muted);margin-left:0.5rem;">
              {user.role === 'manager' ? 'Manager' : 'Shift Lead'}
            </span>
          </div>
          {#if user.id !== data.currentUserId}
            <form method="POST" action="?/remove" use:enhance>
              <input type="hidden" name="id" value={user.id} />
              <button type="submit" style="background:none;font-size:0.875rem;color:var(--danger);">
                Remove
              </button>
            </form>
          {:else}
            <span style="font-size:0.75rem;color:var(--muted);">You</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
