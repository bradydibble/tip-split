# PRD: TipSplit

**Restaurant Tip Calculation and Distribution Tool**

Owner: Brady Dibble | Status: Draft | Last Updated: April 3, 2026

---

## Executive Summary

**Purpose:** Define and approve the requirements for TipSplit, a tip calculation and distribution tool that replaces the manual spreadsheet process currently used to split non-cash tips across restaurant staff.

**Recommendation:** Build Phase 1 as a SvelteKit PWA with Postgres for storage, self-hosted on an EL-based homelab using Podman. Manual staff entry, configurable split logic, and Google Sheets export in Phase 1. Square API integration in Phase 2.

**Investment:** 1 developer, 4-6 weeks for Phase 1 (manual entry + configurable splits + Sheets export). Phase 2 adds Square integration.

**Expected Impact:** Eliminate 20-30 minutes of error-prone manual calculation per shift. Produce an auditable record of every tip distribution automatically.

---

## Background

**Background -** Restaurants that pool tips face a nightly calculation that is surprisingly complex. Non-cash tips (credit card, debit) need to be reduced by processing fees, split across kitchen, bar, and front-of-house staff according to house rules, and then divided among individuals within each group. Most independent restaurants handle this with a calculator, a notebook, or an ad hoc spreadsheet. The process is slow, opaque to staff, and prone to arithmetic errors that erode trust.

The current workflow at this location requires a manager or shift lead to sit down after close, pull numbers from Square, manually compute each staff member's share, and record it somewhere. On a busy night with 10+ staff across two shifts, this takes 20-30 minutes and produces no durable record. If a staff member disputes their payout, there is no audit trail to reference.

---

## Problem Statement

**The Problem -** Tip distribution is manual, error-prone, and undocumented. Every shift close requires a manager to re-derive the same multi-step formula by hand. There is no persistent record, no audit trail, and no way for staff to verify their share independently.

**Journey - Today:**
> "It's 11pm. I need to split tips for tonight. Let me pull up Square on my phone, write down the credit card tip total, grab my calculator, figure out 2.5% fees, then 30% for kitchen, then figure out liquor sales for the bar cut, then divide what's left across six servers. Did I carry that decimal right? Let me redo it. Now let me write everyone's amount on a sticky note and hope nobody asks me to prove the math tomorrow."

**Journey - Tomorrow:**
> "It's 11pm. I open TipSplit, confirm who worked tonight, enter the tip total, and hit calculate. Everyone's share is on screen in seconds. I export to our Google Sheet and hand out cash envelopes. Done in two minutes, and the record is there if anyone has questions."

**Business Impact -** Arithmetic errors in tip distribution create real friction with staff. Even small discrepancies ($2-3) can generate outsized distrust. An auditable, consistent process removes that friction entirely and gives management a defensible record.

---

## Solution

**Recommendation -** Build TipSplit as a SvelteKit progressive web application (installable on phone and desktop, full-screen, no browser chrome) with the following core capabilities:

- Staff roster management (manual entry in Phase 1, Square integration in Phase 2)
- Configurable tip split logic supporting kitchen, bar, and FOH allocations
- Shift-aware calculations (lunch vs. dinner based on configurable time cutoff)
- Google Sheets export (append daily results to a master spreadsheet)
- Lightweight authentication for shift leads and managers

---

## Platform and Architecture Decisions

### Platform: Progressive Web App (PWA)

**Decision:** PWA, not native mobile, not plain web app.

A PWA is a web app that registers a service worker and includes a manifest file (roughly 30 lines of additional code). Staff tap "Add to Home Screen" on iOS or Android and get a full-screen app experience with no browser chrome. No app store review, no $99/year Apple Developer account, no Android sideloading friction (which has gotten worse since Android 14+). Updates deploy instantly. The app shell can be cached for offline access if needed later.

**Why not native:** Development effort roughly doubles for no user-visible benefit at this scale. Cross-platform frameworks (React Native, Flutter) add complexity for a single-dev project. Distribution through app stores introduces review cycles and ongoing maintenance for OS updates. None of that is justified for a single-restaurant internal tool.

### Framework: SvelteKit

**Decision:** SvelteKit, not Next.js, not Express + React.

SvelteKit is a full-stack framework. UI components and server routes (API endpoints) live in the same project. One codebase, one process, one build output that runs as a Node.js server in a container.

**Why SvelteKit over Next.js:** Next.js is tightly coupled to Vercel's platform. Since we are self-hosting, that coupling provides no benefit and adds friction. SvelteKit's build output is a clean Node.js server with no platform-specific adapters to debug.

**Why SvelteKit over Express + React:** Express + React is two things bolted together with more boilerplate and wiring. SvelteKit gives us server-side API routes (needed to keep Square/Google API keys off the client), file-based routing, and a simpler component model with less ceremony than React. Svelte has no virtual DOM and no `useEffect` footguns. For an app that is mostly forms, tables, and a calculation display, Svelte's reactivity model is the better fit.

**Why not a managed service stack (Vercel + Supabase):** Self-hosting demonstrates infrastructure competence, not just application code. No vendor lock-in, no monthly bills, no external dependency that could change pricing or shut down. For a portfolio piece, a Containerfile + compose file showing the full stack is a stronger signal than "I clicked Deploy on Vercel."

### Storage: Postgres (self-hosted)

**Decision:** Postgres container, not Supabase, not Firebase, not SQLite.

Phase 1 needs persistent storage for: user accounts and sessions, default staff roster, configuration parameters (split percentages, shift cutoff). Tip calculation results are ephemeral in the app and persisted via Google Sheets export.

Postgres is the right size for this. A single container, well-understood, runs anywhere, backs up with `pg_dump`. Auth is handled in the SvelteKit app layer using `express-session`-equivalent middleware (SvelteKit hooks + a session store backed by the same Postgres instance). Passwords hashed with bcrypt or argon2.

No managed database service needed. No Supabase (which is Postgres + auth + REST API + dashboard, all of which we are building ourselves at a fraction of the complexity). No Firebase (proprietary, vendor lock-in, overkill).

### Infrastructure: Podman on EL, Self-Hosted

**Decision:** Podman containers on an Enterprise Linux box. Docker Compose equivalent via `podman-compose` or Quadlet systemd units.

The deployment is two containers:

1. **tipsplit-app:** SvelteKit Node.js server (built with `adapter-node`, standalone output)
2. **tipsplit-db:** Postgres 16

Reverse proxy options: Caddy (automatic HTTPS, simple config) or Traefik (if already running on the homelab). Staff access the app at `tips.yourdomain.com` on their phones.

**Podman-specific notes:**
- Podman is daemonless and rootless by default, which is better security posture than Docker for an app handling employee payment data
- `podman-compose` handles simple compose files identically to `docker-compose`
- Alternatively, `podman pod` groups both containers into a shared network namespace (app reaches Postgres on `localhost:5432`)
- On EL9+, Quadlet lets you define containers as systemd units for boot-start, auto-restart, and `journalctl` logging integration

**Proxmox option:** If the EL box gets crowded, spin up an LXC container on Proxmox, install Podman inside it, and run TipSplit there. Clean isolation, easy snapshots, migratable. But not needed unless the EL box is already resource-constrained.

**Containerfile** (roughly):

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["node", "build"]
```

**compose.yaml** (roughly):

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://tipsplit:${DB_PASSWORD}@db:5432/tipsplit
      GOOGLE_SHEETS_CREDENTIALS: ${GOOGLE_SHEETS_CREDENTIALS}
      SQUARE_ACCESS_TOKEN: ${SQUARE_ACCESS_TOKEN}
      SESSION_SECRET: ${SESSION_SECRET}
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: tipsplit
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: tipsplit

volumes:
  pgdata:
```

**Total hosting cost:** $0. Runs on hardware you already own.

### Portfolio Presentation

The GitHub repo README should offer two deployment paths:

1. **Self-hosted (recommended):** Clone, set env vars, `podman-compose up`. Full control, no external dependencies.
2. **Cloud quick-start:** Deploy the SvelteKit app to Vercel/Railway/Fly.io + a managed Postgres instance for reviewers who want to spin it up in 5 minutes without infrastructure.

This shows range: you understand managed services AND you can operate infrastructure.

---

## Requirements

### Staff Management

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| SM-1 | Manually add staff members with name and role (FOH, Kitchen, Bar) | P0 | 1 |
| SM-2 | Assign staff to shift (Lunch, Dinner, Both) for a given day | P0 | 1 |
| SM-3 | Remove/exclude staff from tip calculation (e.g., managers on the floor) | P0 | 1 |
| SM-4 | Persist a default staff roster so users do not re-enter names daily | P0 | 1 |
| SM-5 | When a staff member works both shifts, they appear in both shift calculations and receive a share from each pool independently | P0 | 1 |
| SM-6 | Pull active staff from Square team management / timecards | P1 | 2 |
| SM-7 | Auto-assign shift based on configurable time cutoff (default: 4:00 PM) | P1 | 2 |
| SM-8 | Manual override of auto-assigned shift per person | P1 | 2 |

### Tip Input

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| TI-1 | Accept manual entry of total non-cash tips for the day (or per shift) | P0 | 1 |
| TI-2 | Accept manual entry of total liquor sales for the day (or per shift) | P0 | 1 |
| TI-3 | Pull total non-cash tips from Square for a selected date | P1 | 2 |
| TI-4 | Pull liquor category sales from Square for a selected date | P1 | 2 |
| TI-5 | Manual override when Square data is available (user can correct the number) | P1 | 2 |

### Tip Split Logic

The split calculation must be configurable but needs to support the following default workflow out of the box. Tips are calculated per shift (lunch and dinner are independent calculations).

#### Calculation Flow

| Step | Calculation | Result |
|------|-------------|--------|
| 1. Start | Total non-cash tips for the shift (entered or pulled from Square) | Gross Tips |
| 2. CC Fees | Gross Tips x CC fee rate (default 2.5%) | Tips After Fees |
| 3. Kitchen Split | Tips After Fees x Kitchen % (default 30%) | Kitchen Pool |
| 4. Remaining | Tips After Fees - Kitchen Pool | Post-Kitchen Tips |
| 5. Bar Cut | Liquor Sales x Bar % (default 10%) | Bar Pool (sourced from Post-Kitchen Tips) |
| 6. FOH Pool | Post-Kitchen Tips - Bar Pool | FOH Pool |
| 7. FOH Split | FOH Pool / number of FOH staff on shift (equal shares) | Per-person FOH amount |
| 8. Kitchen Split | Kitchen Pool / number of kitchen staff (equal shares) | Per-person Kitchen amount |
| 9. Bar Total | Bartender's FOH equal share + their portion of the Bar Pool | Per-person Bar amount |

**Key rule on bartenders:** Bartenders are counted as FOH staff for the equal-share split. They receive a standard FOH share from Step 7 plus their cut of the Bar Pool from Step 5. In practice, this means a bartender takes home roughly their FOH share plus the 10% of liquor sales, which on most nights will be a little more than half of the total liquor tip allocation.

#### Requirements

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| TS-1 | Apply configurable CC fee percentage to gross tips (default 2.5%) | P0 | 1 |
| TS-2 | Calculate kitchen pool as configurable % of tips after fees (default 30%) | P0 | 1 |
| TS-3 | Calculate bar pool as configurable % of liquor sales (default 10%), sourced from remaining tips after kitchen split | P0 | 1 |
| TS-4 | Calculate FOH pool as remaining tips after kitchen and bar deductions | P0 | 1 |
| TS-5 | Split FOH pool equally among FOH staff for the shift (bartenders count as FOH) | P0 | 1 |
| TS-6 | Split kitchen pool equally among kitchen staff | P0 | 1 |
| TS-7 | Bartender receives their FOH equal share plus their portion of the bar pool | P0 | 1 |
| TS-8 | Calculate each shift independently (lunch tips split among lunch staff, dinner tips split among dinner staff) | P0 | 1 |
| TS-9 | Staff who work both shifts receive a share from each shift's calculation independently | P0 | 1 |
| TS-10 | All percentages (CC fee, kitchen %, bar liquor %) are configurable in settings | P0 | 1 |
| TS-11 | Support multiple bartenders splitting the bar pool equally | P0 | 1 |

#### Configurable Parameters

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| CC Fee Rate | 2.5% | Percentage deducted from gross tips for credit card processing fees |
| Kitchen Split % | 30% | Percentage of post-fee tips allocated to kitchen pool |
| Bar Liquor % | 10% | Percentage of liquor sales allocated to bartender pool |
| Shift Cutoff Time | 4:00 PM | Clock-in before this time = Lunch; at or after = Dinner |

### Output and Reporting

Each calculation produces a structured summary. This summary is displayed in-app and exported to Google Sheets.

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| OR-1 | Display full calculation breakdown on screen after computation | P0 | 1 |
| OR-2 | Show: Date, Gross Tips, CC Fees, Tips After Fees | P0 | 1 |
| OR-3 | Show: Kitchen Pool amount and per-person kitchen split | P0 | 1 |
| OR-4 | Show: Liquor Sales, Bar Pool (10% of liquor), and per-person bar split | P0 | 1 |
| OR-5 | Show: FOH Pool and per-person FOH split | P0 | 1 |
| OR-6 | Show: Individual staff tip amounts by name and role | P0 | 1 |
| OR-7 | Export full breakdown to Google Sheets (append row to master sheet) | P0 | 1 |
| OR-8 | Google Sheet includes all line items: date, gross tips, CC fees, kitchen split, liquor sales, bar split, FOH split, and per-person amounts | P0 | 1 |

#### Output Summary Structure

The following fields constitute a complete tip distribution record:

- Date
- Shift (Lunch or Dinner)
- Gross Tips (input)
- Credit Card Fee Rate and Fee Amount
- Tips After CC Fees
- Kitchen Split % and Kitchen Pool Amount
- Remaining Tips (after fees and kitchen)
- Liquor Sales Total
- Bar Pool (10% of Liquor Sales)
- FOH Pool (remaining after kitchen and bar)
- Per-person breakdown: FOH staff by name and amount
- Per-person breakdown: Kitchen staff by name and amount
- Per-person breakdown: Bar staff by name and amount (FOH share + bar pool share shown separately)

### Authentication and Access

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| AA-1 | Support multiple user accounts (shift leads, managers) | P0 | 1 |
| AA-2 | Simple login (email/password or PIN) | P0 | 1 |
| AA-3 | Any authenticated user can run tip calculations | P0 | 1 |
| AA-4 | Settings (split percentages, staff roster defaults) editable by manager role only | P1 | 1 |

---

## Phasing

### Phase 1: Core Workflow (Weeks 1-6)

Phase 1 validates the core value proposition: can we replace the manual calculation with a tool that is faster, more accurate, and produces an audit trail? All data entry is manual. No external integrations beyond Google Sheets export.

- Manual staff roster with persist/recall
- Manual tip and liquor sales entry (per shift)
- Configurable split calculation engine
- Shift-aware splits (lunch/dinner calculated independently)
- Multi-shift staff handled by including them in both shift calculations
- On-screen results display
- Google Sheets export (append to master sheet)
- Lightweight auth (shift leads + managers)
- PWA manifest + service worker for home screen installation

### Phase 2: Square Integration (Weeks 7-10)

Phase 2 removes manual data entry by pulling directly from Square. This is where the tool goes from "better than a calculator" to "automated."

- Pull staff roster from Square team management
- Auto-assign shifts based on clock-in time and configurable cutoff
- Pull total non-cash tips from Square for a selected date
- Pull liquor category sales from Square (requires Liquor/Bar category in Square catalog)
- Manual override on all auto-populated fields

### Phase 3: Polish (TBD)

- CC fee calculation by payment source (Visa vs. Amex vs. Debit)
- Historical reporting and trends
- Staff-facing view (read-only, see your own tips)

---

## Square API Findings (Validated)

The following was confirmed by testing against the Square sandbox API on April 3, 2026.

### Per-Payment Tip Amounts: Confirmed

The Payments API returns `tip_money` as a first-class field on each payment object. The Orders API also exposes `total_tip_money` at the order level and `tip_money` on each tender within the order. Daily tip totals can be aggregated by listing payments for a date range and summing `tip_money.amount`.

**Example response shape (from sandbox):**
```json
{
  "payment": {
    "amount_money": { "amount": 5000, "currency": "USD" },
    "tip_money": { "amount": 1000, "currency": "USD" },
    "total_money": { "amount": 6000, "currency": "USD" },
    "card_details": {
      "card": { "card_brand": "VISA", "card_type": "CREDIT" }
    }
  }
}
```

The `card_details.card.card_brand` field also opens the door for Phase 3 per-source CC fee calculation (different rates for Visa vs. Amex vs. Debit).

### Liquor Sales by Category: Confirmed (Two-Step Lookup)

Order line items carry a `catalog_object_id` (the item variation ID), not the category directly. To filter liquor sales, the app needs to:

1. Pull the catalog and build a lookup mapping variation IDs to their parent item's category (one-time cache, refreshed periodically)
2. When processing orders for a date, sum `gross_sales_money` for line items whose `catalog_object_id` maps to the configured Liquor/Bar category

This works cleanly if the restaurant's Square catalog has a dedicated "Liquor" or "Bar" category. If liquor items are mixed into a generic "Beverages" category, the options are: reorganize the Square catalog (probably the right move anyway), or let the user configure which Square categories count as "liquor" in TipSplit's settings.

**Recommendation for Phase 2:** Add a settings screen where the user maps one or more Square catalog categories to "Liquor" for the bar pool calculation. This handles both the clean-catalog and messy-catalog cases.

### Team Members API: Confirmed

Returns team members with `given_name`, `family_name`, `status`, `job_assignments` (including job title), and `assigned_locations`. Sufficient for Phase 2 staff roster import.

---

## Google Sheets Integration

Use Google Sheets API v4 to append rows to a designated spreadsheet. The user configures the target spreadsheet ID and sheet name once in settings. Each calculation appends a row with all output fields. This creates a running audit log that the restaurant owner can review, sort, and archive independently.

---

## Risk and Mitigation

**Risk 1 - Square API limitations:** ~~The Square API may not expose tip data or liquor sales at the granularity needed.~~ **RESOLVED.** Sandbox testing confirms per-payment tip amounts and category-based item filtering both work. Liquor filtering requires a two-step catalog lookup, which is a clean implementation path. Risk is retired for Phase 2.

**Risk 2 - Adoption by shift leads:** If the tool is slower or more cumbersome than the current pen-and-calculator method, shift leads will not use it. Mitigation: Phase 1 must be faster than manual calculation on day one. The target is under 2 minutes from open to export. User test with actual shift leads before declaring Phase 1 complete.

**Risk 3 - Split logic edge cases:** Real-world tip splitting has edge cases (partial shifts, staff who cover multiple roles in a night). Mitigation: Build the calculation engine to be configurable from the start. The default workflow covers the known use case; edge cases get handled through the manual override/exclude controls in SM-3. Multi-shift staff are handled by including them in both shift pools (SM-5, TS-9).

---

## Success Metrics

| Metric | Current State | Target | How Measured |
|--------|---------------|--------|--------------|
| Time to complete tip split | 20-30 min/shift | Under 2 minutes | User observation during Phase 1 testing |
| Calculation errors | Unknown (no audit trail) | Zero arithmetic errors | Compare app output vs. manual spot-check |
| Shift lead adoption | N/A | Used every shift within 2 weeks of launch | Google Sheets row count vs. operating days |
| Staff disputes about tips | Occasional | Zero disputes traceable to math errors | Manager feedback |

**Success criteria -** Phase 1 is successful if shift leads voluntarily use TipSplit for every shift within two weeks of launch, and the exported Google Sheet becomes the system of record for tip distribution.

**Failure criteria -** If shift leads revert to manual calculation within the first month, the tool is too slow or too confusing. Revisit UX before investing in Phase 2.

---

## The Ask

**The Ask -** Approve development of TipSplit Phase 1 as specified above. One developer, 4-6 weeks, targeting a SvelteKit PWA with Postgres, self-hosted via Podman on EL. Manual entry, configurable split logic, Google Sheets export. Phase 2 (Square integration) is scoped and de-risked (API validated) but not approved until Phase 1 validates with actual shift usage.

---

## Open Questions

- Square catalog structure: Does the production Square account already have a "Liquor" or "Bar" category, or do items need to be reorganized before Phase 2? (Owner: Brady, Due: Before Phase 2 build)
- Platform refinement: After Phase 1 usage, assess whether offline PWA caching is needed or if always-connected is sufficient. (Owner: Brady, Due: End of Phase 1)

---

## Appendix A: Calculation Example

The following worked example uses the default configuration to illustrate the full tip split flow for a single dinner shift.

**Inputs:**

- Gross Tips: $1,000.00
- Liquor Sales: $2,500.00
- FOH Staff (Dinner): 5 servers + 1 bartender = 6 total
- Kitchen Staff (Dinner): 3 cooks
- CC Fee Rate: 2.5%
- Kitchen Split: 30%
- Bar Liquor Rate: 10%

**Calculation:**

| Step | Formula | Amount |
|------|---------|--------|
| Gross Tips | (input) | $1,000.00 |
| CC Fees (2.5%) | $1,000.00 x 0.025 | $25.00 |
| Tips After Fees | $1,000.00 - $25.00 | $975.00 |
| Kitchen Pool (30%) | $975.00 x 0.30 | $292.50 |
| Remaining Tips | $975.00 - $292.50 | $682.50 |
| Bar Pool (10% of Liquor Sales) | $2,500.00 x 0.10 | $250.00 |
| FOH Pool | $682.50 - $250.00 | $432.50 |
| Per FOH Person (6 staff) | $432.50 / 6 | $72.08 |
| Per Kitchen Person (3 staff) | $292.50 / 3 | $97.50 |
| Bartender Total | $72.08 (FOH share) + $250.00 (bar pool) | $322.08 |

**Per-Person Output:**

| Name | Role | Shift | Tip Amount |
|------|------|-------|------------|
| Server A | FOH | Dinner | $72.08 |
| Server B | FOH | Dinner | $72.08 |
| Server C | FOH | Dinner | $72.08 |
| Server D | FOH | Dinner | $72.08 |
| Server E | FOH | Dinner | $72.08 |
| Bartender F | Bar / FOH | Dinner | $322.08 |
| Cook G | Kitchen | Dinner | $97.50 |
| Cook H | Kitchen | Dinner | $97.50 |
| Cook I | Kitchen | Dinner | $97.50 |

**Validation:** $72.08 x 5 servers + $322.08 bartender + $97.50 x 3 cooks = $360.40 + $322.08 + $292.50 = $974.98. The $0.02 difference is rounding. The app will handle rounding by assigning remainder cents to the first person in the list.

**Note on bartender economics:** The bartender's $322.08 consists of a $72.08 FOH equal share plus the full $250.00 bar pool. On this night, that bar pool ($250) represents about 55% of the liquor sales tip allocation (the other 45% stays in the FOH pool and gets distributed to all FOH staff including the bartender). The more liquor sales relative to total tips, the more the bartender's total skews above other FOH staff.

---

## Appendix B: Square API Sandbox Test Data

Sandbox testing was performed on April 3, 2026 using the Square sandbox environment. The following objects were created to validate API capabilities:

- **Location:** `L8KDZDN0H4A1N` (Default Test Account)
- **Catalog Category:** `XRTJ7MT6WGL7K2FXDH6MTVQT` (Liquor)
- **Catalog Item:** `LNCUJPABKODGW2RGPJJRG3WP` (Whiskey Neat, linked to Liquor category)
- **Catalog Variation:** `RMGNGKLT42V2KH4AZV74PSYV` (Whiskey Neat - Regular, $12.00)
- **Payment:** `1AHkFWrfniCsbykcJFTAePAXYBUZY` ($50.00 + $10.00 tip, Visa credit)
- **Order:** `qDoXmVA5xhoWWDXpQ3UfDPA3Bo5YY` (2x Whiskey Neat, $24.00)
- **Team Member:** `TMFfRRG3FeVVdW2V` (Sandbox Seller, Owner role)

All API calls returned expected data shapes. No gaps identified for Phase 2 implementation.
