# PRD: TipSplit

**Restaurant Tip Calculation and Distribution Tool**

Owner: Brady Dibble | Status: Phase 1 Built | Last Updated: April 2026

---

## Executive Summary

TipSplit is a SvelteKit progressive web app that replaces the manual post-shift tip calculation process at a restaurant. A shift lead opens the app, confirms who worked, enters gross tips and liquor sales, and hits Calculate. Whole-dollar per-person amounts appear in seconds. One tap exports to Google Sheets. A shareable card is designed to screenshot and paste into a group chat.

**Phase 1** (built): Manual entry, configurable split logic, Google Sheets export, PWA install.
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

## Open Questions

- **Square catalog:** Does the production Square account have a dedicated Liquor/Bar category, or do items need to be reorganized before Phase 2? (Owner: Brady, Before Phase 2)
- **Offline caching:** After Phase 1 usage, assess whether a service worker cache is needed or always-connected is sufficient. (Owner: Brady, End of Phase 1)
- **CC fee by payment type:** Phase 3 candidate — different rates for Visa vs Amex vs Debit. Payment brand is available from Square (`card_details.card.card_brand`).
