<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  import type { ProbeResult } from '$lib/server/square/probe';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let probing = $state(false);
  let selecting = $state(false);
  let syncingRoster = $state(false);
  let syncingCatalog = $state(false);
  let catalogCategories: { id: string; name: string; depth: number; hasChildren: boolean }[] = $state([]);

  // When the probe completes via form action, merge into local state
  let probeResult: ProbeResult | null = $state(data.lastProbe);
  if (form?.probe) probeResult = form.probe;

  $effect(() => {
    if (form?.probe) probeResult = form.probe;
    if (form?.catalogSync?.categories) catalogCategories = form.catalogSync.categories;
  });

  const statusColor = (status: string) =>
    status === 'ok' ? 'var(--success)' :
    status === 'missing_scope' ? 'var(--danger)' :
    status === 'error' ? 'var(--danger)' :
    'var(--muted)';
</script>

<div class="page" style="padding-top:0;">
  <nav class="nav">
    <a href="/settings" class="nav-back" aria-label="Back">←</a>
    <h2>Square Connection</h2>
  </nav>

  <div style="padding:1rem 0;">

    <!-- Connection status -->
    <div class="read-only-banner">
      <strong>⚠ READ-ONLY INTEGRATION</strong> — This connection only reads from
      the Square account. TipSplit never writes to Square. Writing requires
      the operator's explicit approval.
    </div>

    <!-- Connection status -->
    <div class="card">
      <p class="label">Connection Status</p>

      <div class="status-row">
        <span>Token configured</span>
        <span class="badge" style={data.configured ? 'color:var(--success);border-color:var(--success)' : 'color:var(--danger);border-color:var(--danger)'}>
          {data.configured ? 'Yes' : 'No'}
        </span>
      </div>

      <div class="status-row">
        <span>Environment</span>
        <span class="badge">{data.environment === 'mock' ? 'Mock (local fixtures)' : 'Production'}</span>
      </div>

      <div class="status-row">
        <span>API Version</span>
        <span class="badge">{data.apiVersion}</span>
      </div>

      <div class="status-row">
        <span>Selected Location</span>
        {#if data.selectedLocationId}
          <span class="badge badge-current">{data.selectedLocationId.slice(0, 12)}…</span>
        {:else}
          <span class="badge">None</span>
        {/if}
      </div>

      {#if data.connection}
        <div class="status-row">
          <span>Last Validation</span>
          <span class="badge" style="color:var(--success);border-color:var(--success)">OK</span>
        </div>
      {/if}
    </div>

    <!-- Token update (server-side only, never rendered back) -->
    <div class="card">
      <p class="label">Access Token</p>
      <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
        Paste a new Square access token here. It's stored server-side only —
        never sent back to the browser, never logged, never committed.
        Leave blank and submit to clear.
      </p>
      <form method="POST" action="?/updateToken" use:enhance>
        <input class="input" type="password" name="square_token"
          placeholder={data.configured ? '•••••••• (configured — paste new to replace)' : 'Paste Square access token'}
          style="font-family:monospace;font-size:0.85rem;" autocomplete="off" />
        <button type="submit" class="btn btn-secondary" style="margin-top:0.5rem;font-size:0.85rem;">
          {data.configured ? 'Update Token' : 'Save Token'}
        </button>
      </form>
      {#if form?.tokenSaved}
        <p class="success-msg" style="margin-top:0.5rem;">Token saved. Run the capability probe to validate.</p>
      {/if}
      {#if form?.tokenCleared}
        <p class="success-msg" style="margin-top:0.5rem;">Token cleared.</p>
      {/if}
      {#if form?.tokenError}
        <p class="error-msg" style="margin-top:0.5rem;">{form.tokenError}</p>
      {/if}
    </div>

    <!-- Required scopes info -->
    <div class="card">
      <p class="label">Required Square Permissions (read-only)</p>
      <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">
        This token already grants all six. If you ever replace it: OAuth tokens
        get their scopes at authorization time (re-run the flow to widen them),
        or use the Personal Access Token under
        <a href="https://developer.squareup.com/apps" target="_blank" rel="noopener">Credentials</a>,
        which carries full app permissions. Required scopes:
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:0.25rem;">
        {#each ['MERCHANT_PROFILE_READ', 'EMPLOYEES_READ', 'TIMECARDS_READ', 'PAYMENTS_READ', 'ORDERS_READ', 'ITEMS_READ'] as scope}
          <span class="badge" style="font-size:0.75rem;">{scope}</span>
        {/each}
      </div>
    </div>

    <!-- Capability probe -->
    <div class="card">
      <p class="label">Capability Probe</p>
      <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
        Validates read-only access to every required Square endpoint. Records
        only endpoint, status, request ID, and counts — no customer data.
      </p>

      <form method="POST" action="?/probe" use:enhance={() => {
        probing = true;
        return ({ update }) => { probing = false; update(); };
      }}>
        <button type="submit" class="btn btn-secondary" disabled={probing}>
          {probing ? 'Probing…' : 'Run Capability Probe'}
        </button>
      </form>

      {#if form?.probeError}
        <p class="error-msg" style="margin-top:0.75rem;">{form.probeError}</p>
      {/if}

      {#if probeResult}
        <div style="margin-top:1rem;">
          <div class="status-row" style="margin-bottom:0.5rem;">
            <span style="font-weight:600;">Overall</span>
            <span class="badge"
              style={probeResult.overall === 'pass' ? 'color:var(--success);border-color:var(--success)' :
                     probeResult.overall === 'partial' ? 'color:var(--primary);border-color:var(--primary)' :
                     'color:var(--danger);border-color:var(--danger)'}>
              {probeResult.overall.toUpperCase()}
            </span>
          </div>

          {#if probeResult.mockMode}
            <p style="font-size:0.75rem;color:var(--muted);margin-bottom:0.5rem;">
              Running in mock mode (local fixtures, no production Square).
            </p>
          {/if}

          {#if probeResult.missingScopes.length > 0}
            <div style="margin-bottom:0.75rem;">
              <p style="font-size:0.8rem;color:var(--danger);font-weight:600;margin-bottom:0.25rem;">
                Missing scopes:
              </p>
              {#each probeResult.missingScopes as scope}
                <span class="badge" style="color:var(--danger);border-color:var(--danger);margin-right:0.25rem;">
                  {scope}
                </span>
              {/each}
            </div>
          {/if}

          <!-- Endpoint results -->
          <div class="probe-table">
            {#each probeResult.endpoints as ep}
              <div class="probe-row">
                <div class="probe-left">
                  <span class="probe-status-dot" style="background:{statusColor(ep.status)}"></span>
                  <div>
                    <div class="probe-label">{ep.label}</div>
                    <div class="probe-endpoint">{ep.endpoint}</div>
                  </div>
                </div>
                <div class="probe-right">
                  <span class="badge">{ep.recordCount} recs</span>
                  <span class="badge" style="color:{statusColor(ep.status)};border-color:{statusColor(ep.status)}">
                    {ep.requiredScope}
                  </span>
                </div>
              </div>
              {#if ep.error}
                <div class="probe-error">{ep.error}</div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Location selection -->
    {#if probeResult?.locations?.length}
      <div class="card">
        <p class="label">Select Location</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
          Selecting persists the immutable Square location ID (never the
          display name) and the location's timezone for business-date math.
        </p>

        {#each probeResult.locations as loc}
          <form method="POST" action="?/selectLocation" use:enhance={() => {
            selecting = true;
            return ({ update }) => { selecting = false; update(); };
          }} style="margin-bottom:0.75rem;">
            <input type="hidden" name="location_id" value={loc.id} />
            <input type="hidden" name="location_name" value={loc.name} />
            <input type="hidden" name="timezone" value={loc.timezone} />
            <input type="hidden" name="merchant_id" value={probeResult.endpoints[0]?.requiredScope ? 'ML_TEST' : ''} />
            <input type="hidden" name="merchant_name" value="" />
            <input type="hidden" name="currency" value="USD" />

            <button type="submit" class="loc-btn" disabled={selecting || data.selectedLocationId === loc.id}>
              <div class="loc-info">
                <span class="loc-name">{loc.name}</span>
                <span class="loc-meta">{loc.id.slice(0, 16)}… • {loc.timezone}</span>
              </div>
              {#if data.selectedLocationId === loc.id}
                <span class="badge badge-current">Selected</span>
              {:else}
                <span class="badge">Select</span>
              {/if}
            </button>
          </form>
        {/each}
      </div>
    {/if}

    <!-- Clear location -->
    {#if data.selectedLocationId}
      <div class="card">
        <form method="POST" action="?/clearLocation" use:enhance>
          <button type="submit" class="btn btn-danger" style="font-size:0.9rem;">
            Clear Selected Location
          </button>
        </form>
      </div>
    {/if}

    <!-- Roster sync -->
    {#if data.selectedLocationId}
      <div class="card">
        <p class="label">Staff Roster Sync</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
          Sync active staff from Square Team. Staff are matched by immutable
          Square Team ID, never by name. Absent members are deactivated, not
          deleted.
        </p>

        <form method="POST" action="?/syncRoster" use:enhance={() => {
          syncingRoster = true;
          return ({ update }) => { syncingRoster = false; update(); };
        }}>
          <button type="submit" class="btn btn-primary" disabled={syncingRoster}>
            {syncingRoster ? 'Syncing…' : 'Sync Active Staff from Square'}
          </button>
        </form>

        {#if form?.rosterError}
          <p class="error-msg" style="margin-top:0.75rem;">{form.rosterError}</p>
        {/if}

        {#if form?.rosterSync}
          {@const c = form.rosterSync.counts}
          <div style="margin-top:0.75rem;" class="roster-summary">
            <div class="status-row"><span>Fetched from Square</span><span class="badge">{form.rosterSync.fetched}</span></div>
            <div class="status-row"><span>Created</span><span class="badge badge-current">{c.created}</span></div>
            <div class="status-row"><span>Updated</span><span class="badge">{c.updated}</span></div>
            <div class="status-row"><span>Deactivated</span><span class="badge" style="color:var(--danger);border-color:var(--danger)">{c.deactivated}</span></div>
            <div class="status-row"><span>Needs Review</span><span class="badge" style="color:var(--primary);border-color:var(--primary)">{c.needsReview}</span></div>
            <div class="status-row"><span>Excluded</span><span class="badge">{c.excluded}</span></div>
          </div>
        {/if}

        {#if data.needsReviewCount > 0}
          <div style="margin-top:1rem;padding:0.75rem;background:var(--bg);border:1px solid var(--primary);border-radius:8px;">
            <p style="font-size:0.85rem;font-weight:600;color:var(--primary);margin-bottom:0.5rem;">
              {data.needsReviewCount} staff need role review
            </p>
            <p style="font-size:0.75rem;color:var(--muted);">
              These staff have unrecognized Square job titles. Review and assign
              their TipSplit role in the Staff Roster page.
            </p>
            <a href="/settings/staff" style="font-size:0.85rem;display:inline-block;margin-top:0.5rem;">
              Go to Staff Roster →
            </a>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Catalog & Liquor category -->
    {#if data.selectedLocationId}
      <div class="card">
        <p class="label">Catalog & Liquor Classification</p>
        <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem;">
          Sync the catalog to discover categories and configure the
          Cocktails/Liquors root. The root ID is immutable — a renamed
          category still works.
        </p>

        <form method="POST" action="?/syncCatalog" use:enhance={() => {
          syncingCatalog = true;
          return ({ update }) => { syncingCatalog = false; update(); };
        }}>
          <button type="submit" class="btn btn-secondary" disabled={syncingCatalog}>
            {syncingCatalog ? 'Syncing…' : 'Sync Catalog from Square'}
          </button>
        </form>

        {#if form?.catalogError}
          <p class="error-msg" style="margin-top:0.75rem;">{form.catalogError}</p>
        {/if}

        {#if form?.catalogSync}
          <div style="margin-top:0.75rem;" class="roster-summary">
            <div class="status-row"><span>Categories</span><span class="badge">{form.catalogSync.categoryCount}</span></div>
            <div class="status-row"><span>Items</span><span class="badge">{form.catalogSync.itemCount}</span></div>
            <div class="status-row"><span>Variations</span><span class="badge">{form.catalogSync.variationCount}</span></div>
          </div>
          {#if form.catalogSync.autoDetectedLiquorCategoryName}
            <div style="margin-top:0.5rem;padding:0.5rem 0.75rem;background:rgba(16,185,129,0.12);border:1px solid var(--success);border-radius:8px;">
              <span style="font-size:0.85rem;color:var(--success);font-weight:600;">
                ✓ Auto-detected liquor root:
              </span>
              <span style="font-size:0.85rem;margin-left:0.25rem;">
                "{form.catalogSync.autoDetectedLiquorCategoryName}" — auto-selected. Change below if incorrect.
              </span>
            </div>
          {/if}
        {/if}

        {#if data.liquorCategoryId}
          <div style="margin-top:0.75rem;padding:0.5rem 0.75rem;background:var(--bg);border:1px solid var(--success);border-radius:8px;">
            <span style="font-size:0.85rem;color:var(--success);font-weight:600;">Liquor root configured:</span>
            <span class="badge" style="margin-left:0.5rem;">{data.liquorCategoryId.slice(0, 16)}…</span>
          </div>
        {/if}

        {#if catalogCategories.length > 0}
          <div style="margin-top:1rem;">
            <p style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;">Select Cocktails/Liquors root category:</p>
            {#each catalogCategories as cat}
              <form method="POST" action="?/selectLiquorCategory" use:enhance
                style="display:inline-block;margin-right:0.5rem;margin-bottom:0.5rem;">
                <input type="hidden" name="category_id" value={cat.id} />
                <button type="submit"
                  class="cat-btn"
                  style="padding-left: {0.6 + cat.depth * 1.0}rem;"
                  class:selected={data.liquorCategoryId === cat.id}>
                  {cat.name}{cat.hasChildren ? ' ▾' : ''}
                </button>
              </form>
            {/each}
          </div>
        {/if}

        {#if form?.liquorCategorySelected}
          <p class="success-msg" style="margin-top:0.5rem;">Liquor root category saved.</p>
        {/if}
        {#if form?.liquorError}
          <p class="error-msg" style="margin-top:0.5rem;">{form.liquorError}</p>
        {/if}
      </div>
    {/if}

    {#if form?.selected}
      <p class="success-msg">Location selected: {form.selected}</p>
    {/if}
    {#if form?.cleared}
      <p class="success-msg">Location cleared. Using manual-only mode.</p>
    {/if}
    {#if form?.error}
      <p class="error-msg">{form.error}</p>
    {/if}
  </div>
</div>

<style>
  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .status-row:last-child { border-bottom: none; }

  .probe-table {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .probe-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    gap: 0.5rem;
  }
  .probe-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .probe-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .probe-label {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .probe-endpoint {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .probe-right {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .probe-error {
    font-size: 0.75rem;
    color: var(--danger);
    padding: 0 0 0.5rem 1.25rem;
  }

  .loc-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem;
    transition: border-color 0.1s;
  }
  .loc-btn:hover:not(:disabled) { border-color: var(--primary); }
  .loc-btn:disabled { opacity: 0.5; cursor: default; }
  .loc-info { display: flex; flex-direction: column; gap: 0.15rem; text-align: left; }
  .loc-name { font-weight: 600; font-size: 0.95rem; }
  .loc-meta { font-size: 0.75rem; color: var(--muted); }

  code { font-family: 'SF Mono', Monaco, monospace; font-size: 0.85em; }

  .cat-btn {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    font-size: 0.8rem;
  }
  .cat-btn:hover { border-color: var(--primary); }
  .cat-btn.selected {
    background: var(--primary);
    color: #000;
    border-color: var(--primary);
  }

  .read-only-banner {
    background: rgba(245, 158, 11, 0.12);
    border: 1.5px solid var(--primary);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    font-size: 0.8rem;
    line-height: 1.5;
    margin-bottom: 1rem;
    color: var(--primary);
  }
  .read-only-banner strong { font-weight: 800; }
</style>
