# PRD: TipSplit

**Restaurant Tip Calculation and Distribution Tool**

Owner: Brady Dibble | Status: Phase 1 Built | Last Updated: April 2026

---

## Executive Summary

TipSplit is a SvelteKit progressive web app that replaces the manual post-shift tip calculation process at a restaurant. A shift lead opens the app, confirms who worked, enters gross tips and liquor sales, and hits Calculate. Whole-dollar per-person amounts appear in seconds. One tap exports to Google Sheets. A shareable card is designed to screenshot and paste into a group chat.

**Phase 1** (built): Manual entry, configurable split logic, Google Sheets export, PWA install.
**Phase 1.5** (spec'd Aug 2026): Staff identifiers + pay-period tip reporting for payroll (see "Phase 1.5" section).
**Phase 2** (scoped): Square API integration — pull tips and liquor sales automatically, auto-assign shifts from clock-in times.

---

## Problem

Tip distribution is manual, error-prone, and undocumented. Every shift close requires a manager to derive the same multi-step formula by hand using a calculator and a notebook. There is no audit trail, no way for staff to verify their share, and arithmetic errors erode trust.

**Target time to complete a tip split:** under 2 minutes from open to export.
**Current time:** 20–30 minutes.

---

## Solution

A mobile-first PWA installable from the browser home screen (no app store). Staff enter a PIN to log in. The app handles the math and produces a per-person breakdown in whole dollars.

---

## Calculation Logic

Tips are calculated per shift (Lunch and Dinner are independent). The cutoff between Lunch and Dinner defaults to 3:00 PM Pacific (configurable).

| Step | Formula | Notes |
|------|---------|-------|
| 1. CC Fees | Gross Tips × CC fee rate (default 2.5%) | Deducted first |
| 2. Tips After Fees | Gross Tips − CC Fees | |
| 3. Kitchen Pool | Tips After Fees × Kitchen % (default 5%) | |
| 4. Remaining | Tips After Fees − Kitchen Pool | |
| 5. Bar Pool | Liquor Sales × Bar % (default 10%) | Sourced from Remaining |
| 6. FOH Pool | Remaining − Bar Pool | |
| 7. FOH Split | FOH Pool ÷ number of FOH staff | Bartenders excluded from FOH pool |
| 8. Kitchen Split | Kitchen Pool ÷ number of Kitchen staff | |
| 9. Bar Split | Bar Pool ÷ number of Bar staff | Bartenders receive this only |

**Rounding:** All per-person payouts are whole dollar amounts. Each pool is rounded to the nearest dollar (Math.round) before splitting. When a pool doesn't divide evenly, remainder dollars are randomly distributed (+$1 to random recipients) so no one gets shorted more than $1. This matches the cash-envelope workflow.

**Bartender model:** Bartenders receive only their share of the Bar Pool. They are not counted in the FOH pool. This prevents bartenders from diluting the FOH servers' share.

**Configurable parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| CC Fee Rate | 2.5% | Deducted from gross tips |
| Kitchen Split % | 5% | Portion of tips after fees to kitchen |
| Bar Liquor % | 10% | Portion of liquor sales to bar pool |
| Lunch Cutoff | 15:00 Pacific | Determines Lunch vs Dinner shift |

---

## Requirements

### Staff Management

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| SM-1 | Manually add staff with name and role (FOH, Kitchen, Bar) | P0 | 1 ✅ |
| SM-2 | Assign staff to shift for a given calculation | P0 | 1 ✅ |
| SM-3 | Exclude individual staff from a calculation | P0 | 1 ✅ |
| SM-4 | Persist a default staff roster | P0 | 1 ✅ |
| SM-5 | Pull active staff from Square team management | P1 | 2 |
| SM-6 | Auto-assign shift based on clock-in time and configurable cutoff | P1 | 2 |

### Tip Input

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| TI-1 | Manual entry of gross tips (per shift) | P0 | 1 ✅ |
| TI-2 | Manual entry of liquor sales (per shift) | P0 | 1 ✅ |
| TI-3 | Pull non-cash tips from Square for a selected date | P1 | 2 |
| TI-4 | Pull liquor category sales from Square | P1 | 2 |
| TI-5 | Manual override when Square data is auto-populated | P1 | 2 |

### Split Logic

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| TS-1 | Apply configurable CC fee % to gross tips | P0 | 1 ✅ |
| TS-2 | Calculate kitchen pool as configurable % of tips after fees | P0 | 1 ✅ |
| TS-3 | Calculate bar pool as configurable % of liquor sales | P0 | 1 ✅ |
| TS-4 | Calculate FOH pool as remaining after kitchen and bar deductions | P0 | 1 ✅ |
| TS-5 | Split FOH pool equally among FOH staff only (bartenders excluded) | P0 | 1 ✅ |
| TS-6 | Split kitchen pool equally among Kitchen staff | P0 | 1 ✅ |
| TS-7 | Bartender receives bar pool share only | P0 | 1 ✅ |
| TS-8 | Round all per-person amounts to whole dollars | P0 | 1 ✅ |
| TS-9 | Randomly distribute remainder dollars (no one gets shorted >$1) | P0 | 1 ✅ |
| TS-10 | All percentages configurable in settings | P0 | 1 ✅ |
| TS-11 | Support multiple bartenders splitting the bar pool | P0 | 1 ✅ |
| TS-12 | Calculate each shift independently | P0 | 1 ✅ |

### Output and Reporting

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| OR-1 | Display full breakdown on screen after calculation | P0 | 1 ✅ |
| OR-2 | Show: Date, Gross Tips, CC Fees, Tips After Fees | P0 | 1 ✅ |
| OR-3 | Show: Kitchen Pool and per-person kitchen amounts | P0 | 1 ✅ |
| OR-4 | Show: Liquor Sales, Bar Pool, per-person bar amounts | P0 | 1 ✅ |
| OR-5 | Show: FOH Pool and per-person FOH amounts | P0 | 1 ✅ |
| OR-6 | Show: Tips after Kitchen Pool (before bar deduction) | P0 | 1 ✅ |
| OR-7 | Export full breakdown to Google Sheets (append row) | P0 | 1 ✅ |
| OR-8 | Share card view optimized for screenshot and group chat | P0 | 1 ✅ |

### Authentication

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| AA-1 | PIN-only login — no username, PINs unique per user | P0 | 1 ✅ |
| AA-2 | Two roles: shift_lead (calculate + history) and manager (+ settings + user mgmt) | P0 | 1 ✅ |
| AA-3 | Manager creates and distributes PINs in person | P0 | 1 ✅ |
| AA-4 | Session expires after 8 hours | P0 | 1 ✅ |

---

## Technical Architecture

### Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | SvelteKit + TypeScript | Full-stack, file-based routing, clean Node.js build output |
| Adapter | adapter-node | Self-hosted Node.js server, no platform lock-in |
| Database | SQLite via better-sqlite3 | Single file, zero config, sufficient for 2–3 concurrent users |
| Container | node:20 (builder) → node:20-slim (runtime) | Debian base required — Alpine's musl libc breaks better-sqlite3 native bindings |
| Auth | bcrypt (cost 10) + server-side session table | No external auth dependency |
| Testing | Vitest | Fast, native ESM, co-located with source |

### Data Model

All tables carry `location_id INTEGER NOT NULL DEFAULT 1 CHECK (location_id = 1)`. The constraint enforces single-tenant behavior in Phase 1 without a schema migration to add multi-tenant support later.

`tip_distributions` stores a snapshot of `name` and `role` at calculation time (denormalized). History is stable if staff records change.

### Deployment

Self-hosted on a rootless Podman container, managed by a systemd user service. The container image is built on the server — no registry required.

CI/CD via GitHub Actions: the deploy workflow joins the server's Tailscale network ephemerally using `tailscale/github-action`, copies `.env` via scp, then SSHs in to pull, build, and restart. The server has no public IP and no open firewall ports.

---

## Square API (Phase 2 — Validated)

Sandbox testing on April 3, 2026 confirmed:

- **Per-payment tip amounts** — `tip_money` is a first-class field on Payment objects
- **Liquor sales by category** — requires a two-step catalog lookup (variation ID → category). Works if Square catalog has a dedicated Liquor/Bar category
- **Team members** — `given_name`, `family_name`, `job_assignments`, `assigned_locations` available for roster import

Phase 2 adds a `SQUARE_ACCESS_TOKEN` env var and a Square category → "Liquor" mapping in settings.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to complete tip split | Under 2 minutes |
| Arithmetic errors | Zero |
| Shift lead adoption | Every shift within 2 weeks of launch |
| Staff disputes traceable to math | Zero |

---

## Phase 1.5: Staff Identifiers + Pay Period Reporting (Aug 2026)

Status: spec'd and advisory-reviewed (claude, gafton, design review). Supersedes the first draft of this section.

### Purpose

Two needs drive this phase:

1. **Square linkability** — every staff member needs a stable, human-readable unique identifier in TipSplit that can be mapped 1:1 to a Square team member when the Phase 2 Square integration lands.
2. **Payroll** — managers need to see each staff member's total tips aggregated across a pay period, and drill down to the individual shifts those tips came from. The view must be easy to read at a glance and exportable for payroll.

### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| PI-1 | Every staff member gets a stable, human-readable, never-reused unique ID (`staff_code`: `TS-0001`, `TS-0002`, …) assigned atomically at creation from a monotonic counter (`staff_code_seq` setting). Padding grows past 9999 (`TS-10000`); codes are uppercase, immutable, not manager-editable | P0 |
| PI-2 | Staff ID visible in the roster (always), pay-period report, and drill-down. The calculate screen keeps the collision-only badge (disambiguation, not identity) but shows the code instead of the raw DB id | P0 |
| PI-3 | `staff_code` is the TipSplit-side key for the Square team-member mapping (`square_team_member_id` holds the Square side; both on the `staff` row). `tip_distributions` snapshots `staff_code` alongside the existing `name`/`role` snapshot so history stays resolvable | P0 |
| PI-4 | Hard-Remove of a staff member is blocked once they have any `tip_distributions` row (roster offers Deactivate instead). Prevents dangling staff ids and keeps payroll totals reconcilable | P0 |
| PP-1 | New **Admin** section (manager-only) with a **Pay Period Tips** report. Every entry point enforces manager authz via a shared `requireManager()` helper: report load, drill-down load, CSV endpoint (layout guards do not cover `+server.ts`) | P0 |
| PP-2 | Pay period = **14 consecutive business dates** starting on a lattice Sunday. Lattice: a start `S` is on the lattice iff `S` is a Sunday and `(S − anchor) mod 14d == 0`, anchor = setting `pay_period_anchor` (default `2026-08-23`, a Sunday; validated on save). Period 2026-08-23 → 2026-09-05 is the worked example. Membership is by business date (3 AM rollover): a shift closed Sunday 2:59 AM books to business date Saturday and belongs to the period ending that Saturday | P0 |
| PP-3 | Default view: the **current** pay period (the one containing today's business date). One period shown at a time. The current period is labeled "in progress · day N of 14" so a half period is never mistaken for final | P0 |
| PP-4 | Navigate backward to the first period overlapping June 2026 (start 2026-05-31) and forward to the last period starting in the **current year** (dynamic; for 2026 that is 2026-12-27, whose period ends 2027-01-09). Future periods show as "Upcoming" with a real empty state. April/May 2026 calcs remain visible in History but are out of the payroll range (documented) | P0 |
| PP-5 | Report aggregates `tip_distributions.total_cents` per staff member across non-voided calculations whose business date is in `[start, start + 14d)` (half-open — never BETWEEN). Live query, no materialized totals | P0 |
| PP-6 | Report rows: Name (current roster name, fallback historical), Staff ID, Role, Shifts worked (`COUNT(DISTINCT calculation_id)`), Total. Sorted total desc, then name, then staff_code (total order). Grand total computed by a second SQL `SUM` over the same filter (never re-summed in the UI). Footer: "N of M active staff have tips this period" (omission detection) | P0 |
| PP-7 | Drill down from any staff row to a per-shift list: date, shift (Lunch/Dinner), pool breakdown (FOH/Bar/Kitchen/Busser — only non-zero pools shown), shift total, link to the calculation. Drill-down shows the historical recorded name per shift | P0 |
| PP-8 | Voided calculations excluded by default; "Show voided" toggle (consistent with History). The summary strip always shows "N voided excluded" even when the toggle is off (audit signal) | P1 |
| PP-9 | CSV export: `GET /admin/tips/[periodStart]/export.csv`, manager-gated, filename `tips-<start>_<end>.csv`, columns: Period Start, Period End, Staff ID, Name, Role, Shifts, Total (dollars, 2dp). CSV **always excludes voided** regardless of the UI toggle. Trailing metadata rows: generated-at (Pacific), voided-excluded count. All fields sanitized against formula injection (leading `=`, `+`, `-`, `@`, tab, CR get a `'` prefix) | P1 |
| PP-10 | Security fixes shipped with this phase: `void` action becomes manager-only (any logged-in user could currently void a calc — the payroll report is built on void integrity); Google Sheets export sanitizes staff names (same formula-injection hole) and gains the missing Busser share column | P0 |

### Pay period math (implementation contract)

- **Pure calendar arithmetic only.** All period math operates on `YYYY-MM-DD` strings via UTC calendar-day arithmetic (`Date.UTC` + `setUTCDate`, the same discipline as `businessDate()`). Never construct a local `Date` and never add `14 * 86400000` ms — 2026-11-01 is both a lattice start and the PDT→PST transition, and ms math silently shifts every period from mid-November on.
- The lattice is timezone-independent. Only "which period is current" needs a zone: `businessDate(now, settings.timezone)` (default `America/Los_Angeles` = Pacific per deployment spec).
- `periodStartFor(date, anchor)` is a pure function of its arguments (no hidden `new Date()`).
- Off-lattice period in a URL → 303 redirect to the containing period. Out-of-range → 303 to the nearest range end. Invalid staff code → 404.

### Data model changes

- `staff.staff_code TEXT` (nullable at column level; enforced non-null in the insert path) + `CREATE UNIQUE INDEX idx_staff_code`.
- `tip_distributions.staff_code TEXT` (nullable snapshot; backfilled from the join).
- Migration (order matters — must run **after** the Busser table-recreate, which must also copy the new column):
  1. `ALTER TABLE staff ADD COLUMN staff_code TEXT` (nullable — SQLite cannot add NOT NULL/UNIQUE columns).
  2. `ALTER TABLE tip_distributions ADD COLUMN staff_code TEXT`.
  3. Backfill `staff.staff_code = 'TS-' || substr('0000' || id, -4)` where null (idempotent).
  4. `CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_code ON staff(staff_code)`.
  5. Backfill `tip_distributions.staff_code` from the staff join where resolvable.
  6. Indexes: `idx_td_calc(calculation_id)`, `idx_td_staff(staff_id)`, `idx_tc_date(date, voided)`, partial unique `idx_td_calc_staff ON tip_distributions(calculation_id, staff_id) WHERE staff_id IS NOT NULL`.
  7. Counter self-heal: if `staff_code_seq` is missing or non-integer, re-derive from `max(staff_code)`.
- The existing try/catch ALTER loop must only swallow `duplicate column name` — any other error is a real migration failure and must throw (today it would boot cleanly with a silently missing column).
- Counter increment is one statement inside the insert transaction: `UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'staff_code_seq' RETURNING value`.

### Routes

| Route | Purpose |
|-------|---------|
| `/admin/tips` | 303 → `/admin/tips/[currentPeriodStart]` (canonical URL carries the period) |
| `/admin/tips/[periodStart]` | Report page (validates lattice + range, redirects otherwise) |
| `/admin/tips/[periodStart]/export.csv` | CSV download (manager-gated `+server.ts`) |
| `/admin/tips/[periodStart]/staff/[staffCode]` | Drill-down (manager-gated; code validated, 404 if unknown) |

Nav: "Pay Period Tips" link on the Settings page (`.btn-secondary`, alongside Staff Roster / Users) — not in the calculate header (hot path, 480px).

### Design contract (480px, dark, existing tokens)

- New tokens in `+layout.svelte`: `--text-xs 0.75rem`, `--text-2xs 0.7rem`, `--row-y 0.75rem`, `--badge-radius 9999px`, `--row-active var(--surface2)`; pattern classes `.table-row` (2-line grid row), `.badge` (+ `.badge-current` green tint / `.badge-upcoming` neutral fill / `.badge-past` neutral outline), `.stats` (3-column summary strip with dividers).
- Rows are two-line card rows, not a `<table>`: line 1 = Name + ID badge … total (right, `.money`); line 2 = `Role · N shifts` … `›` chevron. Whole row tappable (`<a>`, `:active` feedback), 44px+ targets.
- Period nav: `‹ label ›` with 44px arrow buttons (disabled `opacity:0.4` at range ends, aria-labels), centered tappable label → bottom sheet listing all periods (label + total, current marked), "N of M" position text + thin progress bar.
- Money hierarchy: amber (`--primary`) is the single hero number per screen — grand total and drill-down period total only. Row totals `--text`, sub-lines `--muted`. `tabular-nums` on all figures.
- Summary strip: Period Total / Shifts / Staff Paid (`8 of 12`) in one card.
- Sticky bottom bar: grand total + CSV button (the reconciled number stays visible while scrolling).
- Empty states: Upcoming → "No shifts yet in this period."; staff with $0 → row shown, `$0.00` in muted (zero is data, not error); no staff → "No staff worked this period."

### Testing contract

- `pay-period.test.ts`: lattice with hand-computed literals — anchor (`2026-08-23 → 2026-08-23`), `2026-09-05 → 2026-08-23`, `2026-09-06 → 2026-09-06`, June boundary (`2026-06-13 → 2026-05-31`, `2026-06-14 → 2026-06-14`), **DST** (`2026-10-31 → 2026-10-18`, `2026-11-01 → 2026-11-01`, `2026-11-02 → 2026-11-01`), year boundary (`2026-12-31 → 2026-12-27`, `2027-01-01 → 2026-12-27`); generated 2026 range contains `2026-11-01` and `2026-11-15`; status + day-of-period with injected `now`.
- `pay-period-report.test.ts` (temp SQLite): boundary inclusion (`S−1` out, `S` in, `S+13` in, `S+14` out), voided excluded by default / included on toggle / **never in CSV**, renamed staff (current name in report, historical in drill-down), duplicate names (two rows, distinct codes), NULL `staff_id` (excluded from per-staff rows, surfaced as a count), grand total equals a hand-computed literal; `staff_code` sequence (create 3 → delete middle → next is `TS-0004`), counter self-heal (missing row, corrupt value), UNIQUE violation rolls back cleanly.
- CSV serializer unit tests: `=CMD(...)` escaped, comma quoted, UTF-8 survives.
- `requireManager` with fake locals: manager passes, shift_lead redirected, anonymous redirected.
- No tautologies: no expected values derived from the implementation under test; no re-testing `toFixed`/`Intl`.

### Out of scope (Phase 2 / later)

- Square sync of the mapping, auto clock-in assignment, per-shift Square tip pull.
- Multi-location, per-pool payroll columns, taxes/garnishments.
- `PRAGMA user_version` migration framework (noted for Phase 2; the hand-ordered migration above is the last one written this way).

### Open Questions

- **Pay period anchor:** `2026-08-23` per verbal spec, now a validated setting (`pay_period_anchor`). Confirm the restaurant's actual pay period start day — the whole feature is wrong by a week if it isn't a Sunday-start 14-day period. (Owner: Brady)
- **Square catalog:** Does the production Square account have a dedicated Liquor/Bar category, or do items need to be reorganized before Phase 2? (Owner: Brady, Before Phase 2)
- **Offline caching:** After Phase 1 usage, assess whether a service worker cache is needed or always-connected is sufficient. (Owner: Brady, End of Phase 1)
- **CC fee by payment type:** Phase 3 candidate — different rates for Visa vs Amex vs Debit. Payment brand is available from Square (`card_details.card.card_brand`).
