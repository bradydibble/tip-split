# Square Read-Only Integration Specification

Status: implementation-ready specification, no Square mutations permitted.

## Purpose

TipSplit will use Oh Vashon's production Square account as the read-only source for:

1. Active staff and their stable Square Team IDs.
2. Published scheduled shifts and assigned jobs for a business date.
3. Gross Square tips and liquor sales for Lunch and Dinner shift reports.
4. A manager-initiated re-sync of an unfinalized report.

The integration eliminates re-keying, but never eliminates human accountability. A shift lead must review the generated attendance and explicitly select or confirm each participant's TipSplit role before finalizing a split.

## Non-negotiable constraints

- All Square access is read-only. `POST` search endpoints are acceptable because they retrieve data only. Do not call Square create, update, delete, publish, or webhook-subscription endpoints.
- Square Team is the source of truth for active staff. TipSplit is a local operational mirror, not a competing roster.
- Square scheduled shifts are the source for who was scheduled and the job they were scheduled to work. They do not prove actual attendance. TipSplit records the shift-lead-reviewed participant list as the final operational record.
- The Square production access token, application ID, and application secret stay server-side. Never put them in browser code, form values, logs, test fixtures, exports, or commits.
- The single Oh Vashon physical location is selected by its immutable Square `location_id`, never by display name. Persist the selection in settings after an explicit manager confirmation.
- All business-date and scheduler calculations use the selected Square location's IANA timezone, currently expected to be `America/Los_Angeles`. Never use the server's timezone.
- Existing manual entry remains available as an override. A generated report must show its Square values, manual adjustments, sync timestamp, and Square record counts separately.

## Square endpoints and minimum permissions

Pin a Square API version in the server client. Pagination is mandatory for every list or search endpoint.

| Need | Read-only endpoint | Minimum OAuth permission | Notes |
|---|---|---|---|
| Validate merchant and enumerate locations | `GET /v2/merchants/me`, `GET /v2/locations`, `GET /v2/locations/{id}` | `MERCHANT_PROFILE_READ` | Persist location ID, timezone, currency, and weekly business hours. |
| Active roster and jobs | `POST /v2/team-members/search`; retrieve job definitions when needed | `EMPLOYEES_READ` | Filter to `ACTIVE` and the selected location. Square Team IDs are immutable external keys. |
| Scheduled staff | `POST /v2/labor/scheduled-shifts/search` | `TIMECARDS_READ` | Scheduled Shifts is Beta. Query assigned, published shifts by location and business date. |
| Gross tips | `GET /v2/payments` | `PAYMENTS_READ` | Sum `Payment.tip_money` only for eligible completed payments in the report window. |
| Liquor sales | `POST /v2/orders/search` | `ORDERS_READ` | Search completed orders by `closed_at`, then classify catalog-backed line items. |
| Catalog hierarchy | `GET /v2/catalog/list` or `POST /v2/catalog/batch-retrieve` | `ITEMS_READ` | Read categories, items, and variations. Never change catalog data. |

Reference: [Team search](https://developer.squareup.com/reference/square/team-api/SearchTeamMembers), [scheduled-shift search](https://developer.squareup.com/reference/square/labor-api/SearchScheduledShifts), [Payments](https://developer.squareup.com/reference/square/payments-api), [order search](https://developer.squareup.com/reference/square/orders-api/searchorders), [Catalog category](https://developer.squareup.com/reference/square/objects/CatalogCategory), and [Locations](https://developer.squareup.com/reference/square/objects/Location).

Before coding, run a credential capability probe against production that records only endpoint, status, request ID, counts, and page count. It must not log names, payment details, access tokens, or response bodies. If a required read scope is missing, show a precise settings error and keep the manual workflow usable.

## Staff roster synchronization

### Identity and lifecycle

`TeamMember.id` is the immutable Square identity. TipSplit's existing `staff_code` remains its human-readable local identifier. The mapping is one-to-one.

New and changed fields on `staff`:

| Field | Meaning |
|---|---|
| `square_team_member_id TEXT UNIQUE` | External, immutable Square Team ID. Null only for legacy manual-only staff. |
| `square_status TEXT` | Last observed Square status, normally `ACTIVE` or `INACTIVE`. |
| `square_last_synced_at TEXT` | Audit timestamp. |
| `default_tip_split_role TEXT` | Manager-approved default: `FOH`, `BAR`, `BUSSER`, `KITCHEN`, or `EXCLUDED`. |
| `role_mapping_state TEXT` | `MAPPED`, `NEEDS_REVIEW`, or `EXCLUDED`. |

Sync rules:

1. Query every active Team member assigned to the selected location. Create or update the local record by `square_team_member_id`, never by name.
2. An active Square member absent from a subsequent successful sync is marked locally inactive or `NEEDS_REVIEW`; do not hard-delete anyone with TipSplit history.
3. A Square inactive member is locally deactivated after review and remains in historical reports.
4. Name updates from Square update the live roster. Historical split and attendance snapshots retain the name used at the time.
5. A manager can alter the TipSplit role mapping but cannot alter the Square ID. A mapping correction is audited with prior value, new value, actor, and timestamp.

### Default role mapping

Normalize Square job titles by trimming whitespace and comparing case-insensitively. Exact initial mappings are:

| Square job title | TipSplit default | Treatment |
|---|---|---|
| `MOD`, `Manager`, `Operations Manager`, `Owner` | `EXCLUDED` | Never included in TipSplit participants. |
| `Bartender` | `BAR` | Eligible for bar pool only under current split math. |
| `Busser` | `BUSSER` | Use TipSplit's existing Busser logic. |
| `Cashier`, `FOH Assistant`, `Food Runner` | `FOH` | Eligible for FOH pool. |
| `Cook`, `Dishwasher`, `Kitchen` | `KITCHEN` | Eligible for kitchen pool. |
| Any other title | `NEEDS_REVIEW` | Never silently assigned or paid. |

For a team member with more than one applicable job, retain every mapped job and mark the scheduled job as the report default when Square supplies a `job_id`. If the scheduled job is absent, unknown, or maps ambiguously, the attendee starts in `NEEDS_REVIEW`.

The report UI must expose a role selector for every non-excluded attendee. It starts with their default or scheduled-job role, but the shift lead must explicitly confirm it before finalization. Ambiguous staff require an affirmative selection and cannot be auto-finalized. Excluded staff appear in a collapsed "scheduled but excluded" section for auditability and cannot be added without manager override.

## Shift-report lifecycle

### Business windows

All timestamps use the restaurant's Pacific timezone and are stored as RFC 3339 instants plus the `business_date` (`YYYY-MM-DD`).

| Report | Sales window | Staff window | Automatic draft time |
|---|---|---|---|
| Lunch | Business-date open through 15:00 | Scheduled shifts intersecting the lunch window | 15:05 Pacific |
| Dinner | 15:00 through that day's configured close | Scheduled shifts intersecting the dinner window | 5 minutes after the configured close |

Dinner always begins at 15:00. A closing time that crosses midnight belongs to the dinner business date even though the draft runs on the following calendar day.

Square's `Location.business_hours` provides recurring weekly business hours and the location timezone. It does not provide a reliable dated exception feed for a one-off early or late close. Therefore:

1. On configuration and daily scheduler preparation, sync the selected location's recurring hours.
2. Store the weekly close schedule as the default dinner-close schedule.
3. Provide a manager-only daily dinner-close override with reason and audit trail. This is required for exceptions, events, holidays, or changed hours.
4. The scheduler must never infer close from the latest order or payment.

### Report states and idempotency

Each report is unique on `(location_id, business_date, shift_type)`.

`DRAFT` means Square data may be refreshed. `READY_FOR_REVIEW` means the values and roster are present but role confirmations remain. `FINALIZED` means it is linked to a TipSplit calculation and cannot be overwritten by sync. `VOIDED` is retained for audit.

The automatic scheduler runs at least once per minute. It calculates due reports from location timezone, weekly hours, and overrides. Creating a report is idempotent. Retrying a scheduler job must reopen or update the same unfinalized report, never create a duplicate.

The report page includes **Re-sync from Square** for authorized users. It must:

1. Fetch fresh scheduled shifts, payments, orders, and catalog classification for the report window.
2. Save a new immutable sync snapshot with request ranges, record IDs, counts, values, and timestamp.
3. Update generated attendance. Preserve explicitly confirmed roles when the person remains scheduled. Flag changed, removed, or newly added staff for re-confirmation.
4. Recompute Square-derived tips and liquor sales. Preserve manual adjustments as separate, visible fields.
5. Refuse to overwrite a finalized report. Offer a manager-only "create correction draft" path instead.

Managers can create a Lunch or Dinner report manually for any business date. This covers a missed job, a closed app, and the explicit Lunch exception requested for times other than the normal 15:05 draft.

## Square financial data

### Gross Square tips

Use `ListPayments` scoped to the selected location and the precise report time window. Include only `COMPLETED` payments and sum `tip_money.amount` in cents. Do not derive tips from order totals because Square records tips at the payment level. Do not treat `total_money` as tips.

The report must disclose these limitations:

- Cash tips that were not recorded in Square are not present. The shift lead can add a named manual adjustment.
- Offline POS payments can arrive late. Re-sync must be available after Square transmission catches up.
- Refunds and post-close tip edits can change results. Snapshot IDs and re-sync history make those changes auditable.

### Liquor sales: the Cocktails/Liquors tree

Liquor sales include every active catalog item whose category is `Cocktails/Liquors` or any descendant of that category. Beer, wine, bottled beer, canned beer, and all items outside that category tree are excluded even if their names resemble cocktails.

Implementation:

1. Sync catalog categories and construct their parent chain using `parent_category`, `root_category`, or `path_to_root`.
2. Resolve the configured root category by immutable category ID after a manager selects it from the discovered category list. The intended root is named `Cocktails/Liquors`.
3. Resolve each catalog item variation in completed orders to its parent item and category. Membership is true only if that category belongs to the selected root's descendant closure.
4. Sum the explicitly documented net item-sales basis: catalog-backed liquor line items after item and order discounts, excluding taxes, service charges, and tips. Persist the calculated line amount and inputs per order line in the sync snapshot.
5. Exclude custom line items and unmapped catalog variations from the amount. Surface count and dollar value of exclusions in the review UI. A manager can resolve them through a catalog-mapping review, never by silently counting them.

Returns, exchanges, voids, and split orders must be covered by fixtures before rollout. The implementation must document whether Square reports a negative line, a separate return order, or a refund event and then apply exactly one netting rule. Never count both the original sale and a refund twice.

## Data model

Add a migration, not an ad hoc boot-time ALTER loop. Foreign-key references are logical where SQLite constraints would complicate historical snapshots.

| Table | Essential contents |
|---|---|
| `square_connections` | selected merchant/location IDs, API version, currency, timezone, weekly-hours snapshot, last validation result. |
| `staff_square_jobs` | `staff_id`, Square job ID, title snapshot, mapped TipSplit role, active flag, sync timestamp. |
| `shift_reports` | location, business date, shift type, state, automated/manual source, scheduled instant, close source/override, Square tips, liquor sales, manual adjustments, latest sync timestamp, final calculation ID. |
| `shift_report_attendance` | report, staff, Square team member and scheduled-shift IDs, scheduled job, default role, selected role, confirmation actor/time, inclusion state, name snapshot. |
| `square_sync_runs` | report, start/end bounds, source version, started/completed timestamps, status, request IDs, counts, and error summary. |
| `square_report_records` | sync run, record kind, Square ID, relevant timestamp, cents contribution, classification/result, and a redacted audit payload hash. |
| `dinner_close_overrides` | location, business date, close local time, actor, reason, created timestamp. |

Add unique indexes for the immutable Square IDs and `(location_id, business_date, shift_type)`. Store money as integer cents. Store timestamps in UTC RFC 3339 and business dates as strings.

## User experience

### Settings, manager-only

- Square connection status: merchant, selected location, timezone, last successful validation, last roster sync, and scope failures.
- **Sync active staff from Square** action with a result summary: created, updated, deactivated, needs-review, and excluded counts.
- Role mapping review for unrecognized job titles, with the exact job title and member count.
- Cocktails/Liquors root-category selector, descendant preview, last catalog-sync time, and uncategorized order-line review.
- Weekly dinner close schedule synchronized from Square plus daily exception overrides.

### Shift report, shift-lead workflow

1. Open an automated or manually created Lunch/Dinner draft.
2. See Square gross tips and Cocktails/Liquors sales with sync timestamps and adjustment fields.
3. Review scheduled staff, confirm or select each eligible TipSplit role, and review excluded staff.
4. Press **Re-sync from Square** when needed. Show exactly what changed since the prior snapshot.
5. Create the TipSplit calculation from the reviewed report. Persist report and calculation IDs both ways.

The calculating screen must show source labels, such as `Square synced 8:05 PM` and `Manual adjustment +$12.00`, so the shift lead can explain every number.

## Fulfillment configuration report: separate discovery item

The requested report is: every active menu item should be configured for Pickup and self-serve ordering, and no active item should be configured for shipping.

Do not claim this can be produced from the core Catalog API alone. Current public Catalog objects expose product, category, visibility, and channel information, but the documented API does not provide a reliable per-item Square Online fulfillment configuration equivalent to the Square Dashboard's shipping/pickup settings.

Build this as a separately gated discovery spike:

1. Capture a representative active item from Square Dashboard and all read-only public API objects available for its item, variation, category, channel, and online site.
2. Establish whether a documented, read-only API field fully represents shipping enabled, pickup enabled, and self-serve ordering enabled for that item.
3. If it does, write an item-level audit report with field-level evidence and no mutations.
4. If it does not, deliver a catalog inventory marked `FULFILLMENT_UNVERIFIABLE_BY_PUBLIC_API`, with the manager's manual Square Dashboard verification steps. Do not scrape the Dashboard or call undocumented endpoints without explicit approval.

This discovery result must not block roster or shift-report delivery.

## Security, reliability, and acceptance gates

- Use a server-only Square client with timeouts, pagination, exponential backoff, bounded retries, and rate-limit handling.
- Search requests are idempotent. Every scheduled job has a deterministic idempotency key at the TipSplit database level.
- Log request IDs, operation names, counts, durations, and error codes. Redact all bearer tokens, customer data, payment details, and raw responses.
- Never make an automatic payment, order, team, labor, location, catalog, or webhook mutation.
- Use a test database and recorded redacted Square fixtures. Tests may not contact production Square.
- Add an integration smoke test that runs only when an operator explicitly supplies a production credential and performs only the capability probe.

Release is allowed only when the following all pass:

1. Active staff sync is idempotent and changes no manually entered historical record.
2. Every supplied role mapping, including all exclusions, is covered by tests.
3. Lunch draft appears at 15:05 Pacific. Dinner draft appears 5 minutes after the selected business-date close, including a midnight-crossing close and a daily override.
4. A re-sync changes one draft rather than duplicating it, preserves confirmed roles when appropriate, and refuses to overwrite a final report.
5. Tip totals are derived from completed payment `tip_money`; liquor totals include the entire Cocktails/Liquors descendant tree and exclude beer, wine, bottled beer, and canned beer.
6. Unmapped catalog lines, missing scopes, late offline payments, and Square API errors are visible and recoverable without blocking manual calculation.

