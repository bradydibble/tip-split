# Plan: Oh Vashon Square Read-Only Integration

Companion specification: [Square Read-Only Integration Specification](../square-readonly-integration-spec.md).

## Delivery outcome

TipSplit can mirror active Oh Vashon staff from Square Team, build Lunch and Dinner drafts from the published Square schedule, populate Square tips and Cocktails/Liquors sales, require shift-lead role confirmation, and safely re-sync an unfinalized draft. It does not mutate Square.

## Work order

### Phase 0: integration foundation and production-read validation

1. Add server-only Square configuration loading. Use the existing secret references, never raw values in source or logs.
2. Create a small typed Square client that pins an API version, paginates, applies bounded retry/backoff, and redacts logs.
3. Add a manager-only connection health view. It runs the read-only capability probe and shows endpoint status, request ID, selected merchant, locations, and required missing scopes.
4. Add a schema migration for connection state, square team IDs, sync audit, report drafts, attendance, and close overrides.
5. Build redacted fixture helpers for Team, Locations, scheduled shifts, Payments, Orders, and Catalog responses.

Acceptance:

- No browser bundle contains a Square secret.
- A capability probe performs only reads and records no response body.
- The app remains fully usable with Square unavailable or unconfigured.

### Phase 1: active Team roster mirror

1. Implement paginated `SearchTeamMembers` for `ACTIVE` staff assigned to the selected location.
2. Upsert by `square_team_member_id`; never match staff by name.
3. Persist all job assignments, default-role mappings, and mapping-review state.
4. Add the manager roster sync action and review UI.
5. Mark Square-inactive or absent staff locally inactive without deleting historical data.

Tests:

- Same Square member renamed, synced twice, remains one TipSplit staff record.
- New active member creates a record with a unique `staff_code`.
- Inactive member is deactivated, not deleted.
- Exact mapping tests for MOD, Manager, Operations Manager, Owner, Bartender, Busser, Cashier, FOH Assistant, Food Runner, Cook, Dishwasher, and Kitchen.
- Unknown and multi-job members land in `NEEDS_REVIEW` rather than a silent payout role.

Acceptance:

- The local active roster exactly reconciles to Square Team for the selected location.
- Every eligible active member has a Square ID and default TipSplit role or an explicit needs-review state.

### Phase 2: catalog taxonomy and sales classification

1. Read and snapshot category hierarchy, items, and variations.
2. Add manager configuration for the immutable `Cocktails/Liquors` category root.
3. Construct and test the complete descendant-category closure.
4. Implement completed-order search by `closed_at` and line-item classification.
5. Write persistent sync-record rows so each liquor total can be traced to an order line and catalog classification.
6. Surface unmapped/custom-line exceptions for review.

Tests:

- Root category and nested descendants count as liquor.
- Beer, wine, bottled beer, canned beer, and sibling categories do not count.
- A renamed category still works because the configured category ID has not changed.
- Discounts, modifiers, taxes, returns, split orders, custom items, and missing catalog IDs follow the documented netting rule exactly once.

Acceptance:

- A manager can explain a liquor total down to order and line level without exposing customer data.
- Unknown classifications are visible and excluded, not silently guessed.

### Phase 3: scheduled shifts and role-confirmed attendance

1. Implement `SearchScheduledShifts` for published, assigned shifts on a business date, using the location timezone.
2. Match schedule rows to roster members by Square Team ID and retain Square job ID, title, start, end, and scheduled-shift ID.
3. Partition attendance by Lunch and Dinner business windows, including shifts that cross 15:00.
4. Add a report-attendance editor that pre-populates default roles, displays excluded roles, and requires the shift lead to confirm eligible roles.
5. Retain a full snapshot on report finalization so later schedule edits do not rewrite history.

Tests:

- Published assigned shifts are included; draft and unassigned shifts follow the configured policy.
- A 14:00 to 17:00 shift appears in both relevant review contexts only if the product policy explicitly allows it, otherwise it is assigned once by a documented rule.
- Multi-job staff cannot finalize without an explicit role selection.
- Manager/MOD/Owner scheduled staff are visible as excluded and cannot become paid attendees accidentally.

Acceptance:

- Every generated participant can be traced to a Square scheduled shift, a local Square ID, and a confirmed TipSplit role.

### Phase 4: automatic reports and manual re-sync

1. Implement a timezone-aware scheduler with one-minute evaluation, deterministic report keys, and durable job audit records.
2. Generate Lunch at 15:05 Pacific.
3. Read regular weekly close from the selected Square location, apply an audited daily override when present, and generate Dinner 5 minutes after close. Dinner always begins at 15:00.
4. Allow managers to create either shift manually for a selected business date.
5. Implement re-sync for nonfinalized reports only, with change summary, snapshot history, and preservation/reconfirmation rules for attendance roles.
6. Create the existing TipSplit calculation from a reviewed report and lock the report on finalization.

Tests:

- Scheduler behavior across PDT/PST and a close that crosses midnight.
- Retry of the same due job produces one report.
- Manual trigger and scheduler trigger converge on the same report.
- Re-sync updates Square figures, retains manual adjustments, flags changed roster rows, and cannot overwrite a finalized calculation.

Acceptance:

- Lunch and Dinner drafts appear at the requested times without duplicate reports.
- A shift lead can recover a missed report, late Square data, or roster correction without starting over.

### Phase 5: fulfillment audit discovery spike

1. Determine, with a controlled representative item, whether a documented public read-only Square API exposes per-item shipping, pickup, and self-serve-ordering settings.
2. Write the field mapping and implement the report only if the API result is complete and stable.
3. Otherwise, implement an inventory export that identifies active catalog items and labels fulfillment as unverified, with a manager Dashboard checklist.

Acceptance:

- The app never reports a fulfillment setting as verified unless it came from a documented field that directly represents that setting.
- No Dashboard scraping or undocumented Square endpoint is introduced without explicit approval.

## Suggested implementation slices

Keep pull requests independently deployable:

1. Migration, Square client, capability probe, fixtures.
2. Roster sync and role mapping review.
3. Catalog hierarchy and liquor classifier.
4. Scheduled-shift import and attendance confirmation UI.
5. Report scheduler, manual creation, re-sync, and calculation handoff.
6. Fulfillment discovery report, only after the data source is proven.

## Review checklist for the implementing model

- Confirm every Square call is on the allowlist of read endpoints.
- Confirm the production token is only read in server code.
- Confirm business date uses `America/Los_Angeles`, not host-local time.
- Confirm Team IDs, location IDs, category IDs, scheduled-shift IDs, payment IDs, and order IDs are immutable identifiers, never names.
- Confirm all pagination loops preserve the original query and cursor semantics.
- Confirm money is integer cents and all report amounts retain source and adjustment provenance.
- Confirm the operator must confirm participant roles before finalization.
- Confirm `Cocktails/Liquors` means the entire category subtree, with explicit exclusion of beer and wine categories.
- Confirm a final report cannot be changed by re-sync.
- Confirm automated jobs and UI actions leave an audit trail sufficient to explain a split weeks later.

## Explicit out of scope

- Writing any data back to Square, including Team, Labor, Catalog, Orders, Payments, Locations, webhooks, or fulfillment settings.
- Replacing the restaurant's schedule or timecard system.
- Treating Square schedule as proof of actual attendance.
- Automatic role selection for ambiguous or multi-job employees without shift-lead confirmation.
- Claiming an item is shipping-disabled, pickup-enabled, or self-serve-orderable before a documented public API proves it.

