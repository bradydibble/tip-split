<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let saving = $state(false);
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/calculate" class="nav-back" aria-label="Back">←</a>
    <h2>Settings</h2>
  </nav>

  <div style="padding:1rem 0;">
    <form method="POST" action="?/saveSettings" use:enhance={() => {
      saving = true;
      return ({ update }) => { saving = false; update(); };
    }}>

      <!-- Split config -->
      <div class="card">
        <p class="label">Split Configuration</p>

        <label class="field">
          <span>CC Fee Rate (%)</span>
          <input class="input" type="number" name="cc_fee_rate" step="0.1" min="0" max="10"
            value={data.settings.cc_fee_rate} required />
        </label>

        <label class="field">
          <span>Kitchen Split (%)</span>
          <input class="input" type="number" name="kitchen_pct" step="1" min="0" max="100"
            value={data.settings.kitchen_pct} required />
        </label>

        <label class="field">
          <span>Bar Liquor Rate (%)</span>
          <input class="input" type="number" name="bar_liquor_pct" step="1" min="0" max="100"
            value={data.settings.bar_liquor_pct} required />
        </label>

        <label class="field">
          <span>Lunch Cutoff (Pacific, 24h)</span>
          <input class="input" type="time" name="lunch_cutoff"
            value={data.settings.lunch_cutoff ?? '15:00'} />
        </label>

        <label class="field">
          <span>Restaurant Name</span>
          <input class="input" type="text" name="restaurant_name"
            value={data.settings.restaurant_name} />
        </label>
      </div>

      <!-- Google Sheets -->
      <div class="card">
        <p class="label">Google Sheets Export</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
          Paste the spreadsheet ID from the URL:
          docs.google.com/spreadsheets/d/<strong>THIS_PART</strong>/edit
        </p>

        <label class="field">
          <span>Spreadsheet ID</span>
          <input class="input" type="text" name="google_sheets_spreadsheet_id"
            value={data.settings.google_sheets_spreadsheet_id} placeholder="1BxiMVs0X..." />
        </label>

        <label class="field">
          <span>Sheet Name</span>
          <input class="input" type="text" name="google_sheets_sheet_name"
            value={data.settings.google_sheets_sheet_name} placeholder="Tip History" />
        </label>
      </div>

      {#if form?.error}<p class="error-msg">{form.error}</p>{/if}
      {#if form?.success}<p class="success-msg">Settings saved</p>{/if}

      <button type="submit" class="btn btn-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </form>

    <div style="margin-top:1rem;display:flex;flex-direction:column;gap:0.75rem;">
      <a href="/settings/staff" class="btn btn-secondary">Manage Staff Roster</a>
      <a href="/settings/users" class="btn btn-secondary">Manage Users & PINs</a>
    </div>
  </div>
</div>

<style>
  .field {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  .field:last-child { border-bottom: none; }
  .field .input { width: 140px; text-align: right; }
</style>
