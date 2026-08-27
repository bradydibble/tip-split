# Cashflow Visualization — Design Spec (Phase 1.5, gafton persona)

Target surface: bottom drill-down section of `/calculate/[id]/+page.svelte`.
Single SVG, hand-built, inline. No chart libs. Vertical canvas, ≤480 px wide.
Numerals are the protagonist. Streams/bars are supporting scaffolding for the eye.

Source of truth: `src/lib/calculator.ts::calculate()`.
All monetary inputs are integer cents from `CalcRow` / `DistRow`. Render via `formatCents()`.

Order of operations the diagram MUST honor (matches calculator):

```
GROSS_TIPS
  − CC_FEES                 (gross × ccFeeRate, rounded to $)
  = TIPS_AFTER_FEES
  − KITCHEN_POOL            (tips_after_fees × kitchenPct, rounded)
  − BUSSER_POOL             (busserRateCents × busserStaff.count, FLAT)
  − BAR_POOL                (liquorSalesCents × barLiquorPct, rounded — INDEPENDENT basis)
  = FOH_POOL                (the residue)
```

Note: BAR_POOL basis is liquor sales, NOT the post-busser remainder, but
arithmetically `fohPool = remainingAfterBusser − barPool`. The diagram carves
bar LAST before showing the residue because that is how the algebra resolves
— but the bar stream LABEL must state "% of liquor" so nobody mistakes its
basis. This subtlety is the only place the viz risks lying; handle it by
annotating, not by reordering.

---

## 1. Layout

Vertical schematic at 480 px container width (16 px page gutters ⇒ ~448 px
usable; viewBox drawn at 420 and CSS-scaled to 100%).

```
0        120       210       320       420
┌─────────────────────────────────────────────┐
│ ▾ HOW TIPS FLOWED TONIGHT         [▸ play]  │  §header — tap toggles body
╞═════════════════════════════════════════════┡  hairline border-bottom
│                                             │
│           ┌──────────────┐                  │
│           │  GROSS TIPS   │  11px label      │
│           │  $1,240.00    │  22px mono ★     │
│           └───────┬───────┘                  │
│                   │                          │
│         ┌─ FEES ─▼┐  ← leftward spillover    │
│         │ −$31.00 │     muted-danger #c66    │
│         └─────────┘     (the "lost" sink)    │
│                   │                          │
│           ┌───────▼────────┐                 │
│           │ AFTER FEES     │  16px mono       │
│           │ $1,209.00      │  --text          │
│           └───────┬────────┘                 │
│                   │                          │
│   ╭──── ELBOW ────▼───────╮  (diverter tee)   │
│   │                      │                   │
│   │   MAIN SPINE ↓       └──► KITCHEN POOL   │ ← culvert pops RIGHT
│   │   (left zone)            5% · $60 ●─┐    │   steel-blue #69c
│   │                                   │    │
│   │                                   ▼ fan │
│   │                            [▎20][▎20][▎20]│ N cook pill-stubs
│   │                                   │    │   height ∝ $
│   │   ╰──── (spine resumes) ───────────╯    │
│   │                                          │
│   │   ──► BUSSER POOL   2×$20 = $40 ●─┐      │  violet #c4c
│   │                                   ▼      │
│   │                              [▎20][▎20]   │ (absent → entire band elided,
│   │                                   │      │  no stub, no zero row)
│   │   ╰────────────────────────────────╯    │
│   │                                          │
│   │   ──► BAR POOL   10% of $3.0k = $300 ●─┐  │  amber #c84
│   │                                         ▼ │
│   │                               [▎150][▎150] │ bar staff pill-stubs
│   │                                   │       │
│   │   ╰────────────────────────────────╯     │
│   │                                           │
│   │   ═══ FOH POOL (RESIDUE) ═══ $X ÷ (N+M) ●─┐│  teal #4a9
│   │                                            ▼
│   │   [pill][pill][pill][pill][pill]            │ ◄ FOH staff + Bar staff
│   │    ↑                ↑                        │   participating; Bar stubs
│   │    │                │                        │   carry a ◆ dual-feed marker
│   │    │                └──── same person also ──┤
│   │    │                      receives bar feed  │
│   │    └── bridge marker links upward to bar band │
│   │                                            │ │
│   ▼ (terminal reservoir — empty)               │ │
│                                                ▼ ▼
│   ╔═════════════ PERSONAL OUTCOMES ═══════════╗│
│   ║ Alex        $118     ▏▕  [FOH]            ║│ green pill, 18px mono
│   ║ Sam         $268 ◆   ▏▕  [FOH][BAR]       ║│ ◆ = received ≥2 feeds
│   ║ Riley       $ 20     ▏▕  [BUS]            ║│
│   ║ Cooke A.    $ 20     ▏▕  [KIT]            ║│
│   ║ Cooke B.    $ 20 ⚠▶ ▏▕  [KIT]             ║│ ⚠ = adjustment applied
│   ║                       dashed route ──►    ║│ ▶ reroute shown below
│   ╚══════════════════════════════════════════╝│
│                                              │
└──────────────────────────────────────────────┘
```

Geometry zones (viewBox units, 420 wide):

- **Spine lane** `x ∈ [60, 130]`, center 95. Carries the main downward flow.
- **Outflow pocket** (fees) sits `x ∈ [20, 56]`, left of spine, semi-detached.
- **Pool culvert popouts** originate at spine `x=95`, elbow east at `y=node`,
  land at culvert inlet `x=210`. Culvert bodies span `x ∈ [210, 400]`.
- **Person pill-stub row** sits below each culvert, `y += 36`, horizontally
  justified within `x ∈ [200, 400]`, pill width fixed 56, gap 8.
- **Bridge markers** (`◆` glyph, 9px) sit at the spine-side end of any
  bar-staff pill in the FOH band, paired with a hairline arc climbing UP to
  that same person's pill in the Bar band. Bidirectional tag, never arrows.
- **Terminal reservoir** is the only place names + final totals appear in
  full; culvert stubs show `$amt` only (no name) to avoid restating the
  tables above. Names render ONCE here in the diagram.

Why a SINGLE terminal ledger (vs per-pool name lists): kills the duplication
problem outright. Every dollar is traced to a person by CONNECTOR GEOMETRY,
not by repeated name printing.

---

## 2. SVG Anatomy

Root:

```svg
<svg viewBox="0 0 420 {{dynHeight}}" role="img"
     aria-labelledby="cashflow-title cashflow-desc"
     xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="xMidYMin meet"
     style="width:100%;height:auto;display:block;overflow:visible">
  <title id="cashflow-title">Cash flow for {date} {shift}</title>
  <desc  id="cashflow-desc">{ordered prose fallback}</desc>
  …defs…
  …stages…
</svg>
```

`{{dynHeight}}` computed server-side or via reactive `$derived` summing all
band heights; exposed so the parent `<section>` collapse can size correctly.

### Defs (declared once, `<use>`'d repeatedly)

- `<linearGradient id="gradFeed-{role}">` — vertical 100%→60% alpha of the
  role hue. Used for spine + connector strokes only. Fill of bars stays SOLID
  role hue (gradients on bars read as "marketing").
- `<pattern id="adjHatch" patternUnits="userSpaceOnUse" width="6" height="6"
  patternTransform="rotate(45)">` — two `<line>` strokes of `--danger #c66` at
  1px. Clipped onto the skimmed wedge of an adjusted pill.
- `<marker id="arrowDanger">` — 5-unit triangle, fill `#c66`, orient auto.
- `<marker id="arrowNeutral">` — 3-unit triangle, fill `--muted #888`.

### Reusable shapes (these become `<symbol>` or generator snippets)

1. **`poolNode`** — a culvert header. Rectangle 190×34, rx=6, stroke
   `hairline` 1px in role hue at 40% alpha, fill `transparent`. Contains two
   `<text>` children:
   - label `"KIT"` 11px sans uppercase letterspacing 0.08em, role hue, top-left `pad-x:8`.
   - total `"$60"` 16px mono, role hue full strength, mid-baseline right-aligned.
   A third `<text>` renders `"÷ 3"` 11px sans muted, trailing the total.
   Geometry anchors: `{inlet:(210,y)}`, `{centerBody:(305,y)}`.

2. **`pillStub`** — a person's contribution bar FROM a single pool.
   Width FIXED 56 px. Height `clamp($amt/$maxAmtInBand × 60, 14, 60)` px.
   Rect rx=4, fill = role hue solid, stroke none. At the foot, a sliver tick
   (`rect` 56×2) in role hue darker shade indicates "this is the exit".
   Center text `"$20"` 13px mono bold, color `#fff` if contrast ≥ AA else `#0a0a0a`.
   NO name label here (names deferred to terminal ledger).
   Hidden entirely when `count===0` — emit NOTHING, not a zero-pill.

3. **`personCard`** — terminal ledger row. Width ~380 px, height 40 px.
   Three zones left→right:
   - Name (13px sans semibold, `--text`) + optional ◆ glyph appended for dual-feed.
   - Right-cluster: take-home `$118` (18px mono bold, `--primary`); below it, the
     `pb-chip` row mirroring existing markup EXACTLY (reuse the `.pb-*` classes),
     one chip per non-zero `{role}_share_cents`.
   - Far-right: `⚠ ▶` affordance iff `adjustment_cents != 0`, opens the
     redirect overlay for that person.
   Background `var(--surface)`, hairline `--border`, hover: 4% lift toward `--bg`.
   This is the ONLY place the user sees the name + total combo in the viz.

4. **`connector`** — polyline. Two flavors:
   - **Elbow (mechanical)** — `M sx,sy L mx,sy L ex,ey` where `mx=(sx+ex)/2`,
     rounded joins only. Stroke role-hue gradient, width
     `clamp($streamAmt/$grossAmt × 22, 2, 22)`, opacity 0.7.
     Stroke-linecap butt, stroke-linejoin round (r=2).
   - **Feeder leg** (culvert → stub) — short vertical `L` from culvert outlet
     at `(305, y_out)` dropping to the stub row anchor. Same stroke rule.
   - **Dual feeder merge** — for bar staff, BOTH the bar-band stub connector
     AND the foh-band stub connector terminate at the same `personCard` pill.
     Visualize convergence by offsetting the two legs by ±4 px on landing and
     adding a small 1px diamond "◆ merge node" where they coincide.

5. **`feeSink`** — left-pocket block. Half-height rectangle (170×~24) bound to
   the LEFT of the spine, fill `rgba(204,102,102,0.06)`, dashed 1px `#c66`.
   Text `"−$31"` 14px mono bold `#c66`; subtitle `"CC fees · 2.5%"` 9px sans muted.
   Connected to the spine by a short leftward elbow WITHOUT arrowhead (an
   outflow should not feel aggressive; the leading minus sign carries the tone).

6. **`reservoirFoot`** — terminal anchor of the spine. Small unfilled circle
   `r=3` at the bottom of the spine lane, fill `--bg`, stroke `--muted` 1px.
   Annotation: `"(all tips distributed)"` 9px sans muted, italics OFF.
   Shown ONLY when `sum(distributions.totalCents) === calc.tips_after_fees_cents`
   (the normal case). On imbalance due to rounding residue (rare), render a
   SECONDARY pill to the reservoir labelled `"rounding"` `--muted` carrying
   the leftover pennies — never let the diagram lie about conservation.

### Coordinate conventions

- All numeric text uses `font-family: var(--mono, ui-monospace, SFMono-Regular)`
  with `text-rendering: geometricPrecision`.
- All sans text uses the page's body font.
- `dominant-baseline` central; `text-anchor` per zone (start/middle/end) —
  set explicitly, never inherited from CSS for SVG.
- Strokes float-aligned to half-pixels: prefer `*.5` x-coords on 1px verticals
  to keep hairlines crisp under devicePixelRatio scaling.

### Ordering inside `<svg>` (painter's algorithm matters)

1. background wells (rounded `--bg` panel backing the whole viz, optional)
2. spine + culvert rectangles (so strokes sit UNDER text)
3. connectors
4. culvert text
5. pill-stub rects + amounts
6. terminal `personCard`s (drawn last, on top — highest priority for the eye)
7. adjustment overlay layer (always top-most; reads as "exception")

---

## 3. Color + Type Scale

### Role hues (already shipped as `pb-chip` borders; reuse verbatim)

| Role      | Hex      | Use                                  |
|-----------|----------|--------------------------------------|
| FOH       | `#4a9`   | residue pool stream + chips          |
| Bar       | `#c84`   | bar pool stream + chips              |
| Kitchen   | `#69c`   | kitchen pool stream + chips          |
| Busser    | `#c4c`   | busser pool stream + chips           |
| Fees/loss | `#c66`   | outflow pockets, danger-hint fills   |

### Neutrals (assume app tokens exist; pin fallbacks anyway)

| Token      | Value (dark theme) | Use                                |
|------------|--------------------|------------------------------------|
| `--bg`     | `#0b0d0c`          | page backdrop behind viz          |
| `--surface`| `#14171a`          | person-card fill, header fill     |
| `--border` | `rgba(255,255,255,0.07)` | all 1px hairlines            |
| `--muted`  | `#7a8085`          | secondary labels, divider meta    |
| `--text`   | `#f2f3f1`          | names, primary captions           |
| `--primary`| `#2f6`             | take-home numerals only           |
| `--danger` | `#c66`             | overlays, voiding indicators      |

Do NOT introduce new hues. If a future role appears, allocate a new chip
class first, then mirror it here — never bypass the chip palette.

### Type scale (explicit px)

| Element                    | Size | Weight | Family    | Color           |
|---------------------------|------|--------|-----------|-----------------|
| Section toggle header     | 14   | 600    | sans      | `--text`        |
| Header sub-affordance (▸) | 11   | 500    | sans      | `--muted`       |
| Gross top-of-funnel figure| 22   | 700    | mono      | `--text`        |
| Gross label               | 11   | 500    | sans UC   | `--muted`       |
| After-fees figure         | 16   | 600    | mono      | `--text`        |
| Fee amount (`−$XX`)       | 14   | 700    | mono      | `#c66`          |
| Fee caption              | 9    | 400    | sans      | `--muted`       |
| Pool culvert label        | 11   | 600    | sans UC   | role hue        |
| Pool culvert total       | 16   | 600    | mono      | role hue        |
| Pool divisor `÷ N`        | 11   | 400    | sans      | `--muted`       |
| Stub amount (in bar)     | 13   | 700    | mono      | `#fff`/`#0a0a0a` |
| Personal name             | 13   | 600    | sans      | `--text`        |
| Take-home total           | 18   | 700    | mono      | `--primary`     |
| Chip text (`pb-chip`)     | 9    | 600    | sans UC   | per pb-class    |
| Adjust amount tag         | 10   | 700    | mono      | `#c66`          |
| Bridge ◆ glyph            | 9    | 700    | sans      | `#c84`          |
| Reservoir footnote        | 9    | 400    | sans      | `--muted`       |

Rules:
- Sans in uppercase wherever it pairs with a coloured numeral (labels
  belong to numerals, numerals belong to the user).
- Mono owns EVERYTHING denominated in money.
- Tabular-figure variant forced where supported (`font-feature-settings:"tnum"`).
- Letter-spacing 0.08em on all uppercase labels; 0 elsewhere.

---

## 4. Adjustment Overlay Design

Trigger condition: at least one `DistRow.adjustment_cents !== 0` in the dataset.
Rendered as a discrete LAYER atop the static diagram; toggled ON via the `⚠`
glyph on the affected `personCard` (per-person) or globally via a `[▸ show
redirections]` toggle near the section header. OFF by default — adjustments
are exceptions, not the headline; surfacing them always-on degrades scanning.

### Anatomy of one redirection

For an adjusted person P whose withheld fraction is
`r = abs(adjustment_cents) / originalBase(P)` distributed among recipients
`R₁..Rₖ` (members of P's role, or downstream partners per existing server
logic):

1. **Skim-wedge** on P's `personCard`: a hatched rect overlaid on the TOP
   `r×cardHeight` portion of the card's bar slot, fill `url(#adjHatch)`,
   bounded by a 1px `#c66` underline. Communicates "this much leaves".

2. **Origin port**: a 4px square peg punched at the right edge of P's card,
   colour `#c66`. Label beside it: `"−$X.XX"` 10px mono `#c66` +
   `" ⚠ {reason}"` 9px sans muted (reason pulled from `DistRow`/adjustment
   log; if blank, omit the clause entirely — no placeholder dashes).

3. **Dashed divergence**: one polyline per recipient
   `M (originPort) ⟿ (recipientPort)`, stroke `#c66`, `stroke-dasharray 4 3`,
   strokeWidth 2, elbow-cornered, with `marker-end="url(#arrowDanger)"`.
   Convergence point on each recipient `Rᵢ` is a 4px square peg on that
   card's left edge, labelled `"+$yᵢ.YY"` 10px mono `#c66`.

4. **Conservation tick**: at the origin port, a tiny `Σ` 9px sans muted
   denotes that the outbound amounts equal the inbound amounts modulo
   rounding residue. Visible only when toggling a "verbose" gear button —
   off by default to stay clean.

5. **No-playback default**: animation ABSENT. The dashed route is STATIC.
   An optional `▸ play` affordance below the overlay plays a ONE-SHOT SMIL
   sweep: `<animate attributeName="stroke-dashoffset" from="{len}" to="0"
   dur="0.8s" fill="freeze" begin="indefinite"/>` triggered imperatively on
   click. Wrapped in `@media (prefers-reduced-motion: reduce){ animate{
   display:none } }` so the route just appears instantly.

### Solo-bartender downstream fan-out

When the adjusted person is the sole member of their role, the withheld $
flows DOWNSTREAM (existing server logic — see `+page.svelte` adjust form
comment). Visually, the dashed divergence routes NOT laterally but
DOWNWARD across the reservoir boundary to recipient cards in the next
eligible tier, crossing the existing pool-band connectors at right angles
(no fusion). Crossings remain visible as plain over/under passes (overlay
layer draws LAST, so it sits on top — acceptable; no z-order hacks).

Downstream routes MUST use the SAME dashed style, not a new pattern — the
visual vocabulary stays uniform regardless of where the money lands.

### Multiple adjustments

Stack separately; each originates from its own ⚠ glyph. Where two divergent
routes happen to overlap a recipient port, stagger ports vertically along
the card edge in 6 px increments rather than stacking dots.

### Edge: adjustment reduces a card to ~$0

The skim-wedge consumes nearly the entire card. Still render the card
(never delete), name stays, total drops to a 14px mono `#c66 "$0.00"`
rather than `--primary` — keeping the wasteland visible preserves trust.

---

## 5. Responsive Collapse

The whole viz lives inside a `<section class="cashflow">` placed at the END
of the existing `+page.svelte` content, AFTER the per-role cards and BEFORE
the actions block (or after actions — implementer's call, see Q7.1).

Markup sketch:

```html
<section class="cashflow">
  <button class="cf-toggle" aria-expanded="false" aria-controls="cf-body"
          type="button">
    <span class="cf-chevron" aria-hidden="true"></span>
    How tips flowed tonight
  </button>
  <div id="cf-body" class="cf-body" role="region" aria-labelledby="...">
    <!-- the inline SVG -->
  </div>
</section>
```

CSS (mirrors the existing dark-token aesthetic; no new tokens introduced):

```css
.cf-toggle {
  width:100%; appearance:none; background:var(--surface);
  color:var(--text); font:600 14px/1 var(--sans);
  text-align:left; padding:.85rem 1rem;
  border:1px solid var(--border); border-radius:12px;
  display:flex; align-items:center; gap:.6rem;
  /* sticky to top of section scroll */
}
.cf-toggle:active { border-color:var(--primary); }
.cf-chevron {
  width:.6rem; height:.6rem; display:inline-block;
  border-right:2px solid currentColor; border-bottom:2px solid currentColor;
  transform:rotate(45deg); /* points ▾ expanded */
  transition:transform 220ms cubic-bezier(.4,.0,.2,1);
  margin-right:.15rem;
}
.cf-toggle[aria-expanded="true"] .cf-chevron { transform:rotate(-135deg); }

.cf-body {
  overflow:hidden;
  max-height:0; opacity:0;
  /* SVG height is auto, grows with content; cap generously */
  transition:max-height 260ms cubic-bezier(.4,0,.2,1),
             opacity 200ms ease-out 30ms;
}
.cf-toggle[aria-expanded="true"] + .cf-body {
  max-height:3200px; opacity:1;
}
/* Allow horizontal pinching on landscape phones; viz scales uniformly */
@media (max-width:480px){
  .cf-body svg { max-height:none; }   /* no clipping while scrolling */
}
@media (prefers-reduced-motion:reduce){
  .cf-body, .cf-chevron { transition:none; }
  .cf-toggle[aria-expanded="true"] + .cf-body { max-height:none; }
}
```

State: collapsed by default. Persist open-state per-calculation in
`sessionStorage` keyed `cf:{calc.id}` if a session memory channel exists;
otherwise leave stateful in-memory only (cheap re-render on revisit).

Behavioural rationale: a tired server usually trusts the tables above; the
viz is OPT-IN for the curious auditor or dispute moment. Default closed =
fast page-load perception + lower DOM cost on the common path.

Touch target: full-row (≥44 px). Chevron icon-only is forbidden on mobile —
the entire label acts as the affordance, icon is decoration.

---

## 6. Edge Cases

Each must yield a SELF-EVIDENT diagram with no broken stubs.

### 6.1 Zero gross tips
Hide the ENTIRE `<section class="cashflow">`. There is nothing to trace and
showing an empty spine misleads a quick scanner. `CalcRow.voided` shares
this treatment (next item).

### 6.2 Voided calculation (`c.voided === true`)
Suppress the section wholesale. The page already hoists a red-bordered
"This calculation has been voided" notice higher up; a competing silent
flowchart would dilute the warning. The void notice wins real estate.

### 6.3 Zero liquor sales (`liquor_sales_cents === 0`)
`bar_pool_cents = 0`. Elide the BAR POOL culvert AND its pill-stub row
completely (rule §2.2: emit NOTHING, not a zero-pill). Crucially, Bar staff
who would normally show a dual feed STILL appear once in the FOH band with
their ◆ marker UNCHANGED — but the upper-bar side of the bridge terminates
at a grey "no liquor tonite" annotation pinned at the spine elbow where the
bar culvert WOULD have begun. Text: `"NO BAR POOL · $0 liquor"` 10px sans
italic-OFF muted. This stops anyone assuming a bug dropped their bar pay.

### 6.4 Zero bussers (`busserStaff.length === 0`)
Most common elision. Busser culvert + stub row removed entirely. Spine
elbows past the missing node cleanly (single straight drop). No caption —
nothing notable happened. MENTION bussers only if a user gripes; the data
speaks.

### 6.5 Single bar staff AND zero bar pool
Same as 6.3 effect — the lone bartender still earns FOH-share, marked ◆.
Their `totalCents == fohShareCents`; the `[BAR]` chip is OMITTED (we render
chips only when nonzero — same gate as existing `distRow`). No special-case
art needed; general rule already produces correct output.

### 6.6 Zero kitchen staff (`kitchenStaff.length === 0`)
Two valid scenarios depending on `kitchen_pct`:
- If `kitchen_pct === 0` (no pool declared): elide culvert like the busser
  case. Caption NONE.
- If `kitchen_pct > 0` BUT no kitchen staff rostered: dangerous situation
  — pool dollars exist with nowhere to land. SURFACE THIS: render the
  culvert in `#c66` outline (instead of steel blue), labelled
  `"KIT 5% $60 · NO RECIPIENTS"` with a ⚠ prefix and a route to the
  reservoir labelled `"undistributed"`. Treat identically to an
  adjustment downstream failure. Do NOT silently swallow the cash.

### 6.7 Zero FOH pool participants (`fohStaff.length + barStaff.length === 0`)
Mirror 6.6 dangerous scenario. The `remainingAfterBusser − barPool`
balance sits undistributable: render a `#c66` reservoir pill tagged
`"UNCLAIMED — no FOH/bar staff"` draining visibly into a `#c66` footnote.
Never suppress a positive undistributed amount — conservation honesty
trumps tidiness.

### 6.8 Adjusted SOLO bartender (withheld$ goes downstream)
Spec'd in §4 "Solo-bartester downstream fan-out". Recap: dashed route
crosses the reservoir boundary downward to next-tier recipient cards,
straight-elbowed, no new marker style. Recipients typically FOH peers;
their `personCard`s gain inbound ports stacked as described in §4 step 5.
Visual goal: convey "this wasn't lost, it relocated" without ambiguity.

### 6.9 Multi-adjustment evening (rare, but plausible)
Multiple ⚠ glyphs lit simultaneously. Stack outbound ports vertically per
§4 step 5. If two adjustments hit the same recipient, the inbound "+$"
tag aggregates into a single `"+$X.YY (from 2 redirects)"` 9px muted
suffix. Prefer this aggregation over a wall of individual plus-tags.

### 6.10 Rounding residue ≠ 0 (1–99¢ leakage)
See §2 `reservoirFoot` clause: secondary muted pill labelled `"rounding"`
carrying the pennies. Reservoir footnote becomes
`"{sum} distributed · {diff} rounded"`. Do NOT pretend the leak is gone.

### 6.11 Extremely tall personal outcome section (>9 people)
Cap terminal ledger to viewport-friendly pagination is FORBIDDEN (extra JS
complexity). Instead, ALLOW the section to grow naturally; rely on the
parent toggle's `max-height:3200px` ceiling being generous and bumping via
JS-measured height on expansion (described loosely in Q7.2 — implementer
must decide whether to measure-and-set or accept the ceiling).

---

## 7. Open Questions (decisions intentionally deferred)

These are the choices I deliberately did NOT freeze, with rationale. The
implementer should resolve them via judgment, not by re-consulting me.

### 7.1 Section placement vs. actions block
Is the cashflow viz better positioned BEFORE the action buttons (Share /
Export / Void) or AFTER them? I leaned AFTER actions, treating the actions
as primary utility and the viz as forensic — but a defender of "scan the
flow first, then export" deserves a hearing. Pick one; do not interpolate
based on viewport.

### 7.2 Collapse sizing: `max-height` ceiling vs. measured set
I gave `max-height:3200px` as a generous constant for transitions. Two roads:
(a) Leave the constant and accept graceful fade once exceeded (very rare
given typical shift sizes); (b) Measure `scrollHeight` on first expand and
write it to a CSS custom property so transitions stay accurate. Road (b)
adds ~6 lines of Svelte `$effect`. Choose based on your bundle-size budget
tolerance; this is a perf-vs-polish tradeoff only.

### 7.3 Pill-stub name omission confidence
I chose to omit names from culvert stubs and print them ONCE in the
terminal ledger, reasoning this avoids restating the tables above. Risk:
on very tall diagrams, the connection between a culvert's pill and a far-
below ledger row becomes hard to trace. Alternative: print first-names in
8px muted under EACH stub, accepting light redundancy. If you find tester
squinting often, switch to the latter and live with the mild duplication —
the instruction prohibiting duplication is a guideline, not a constraint
that justifies UX harm.

### 7.4 Connector curve strategy: elbows vs soft quadratics
I mandated elbow polylines (Dieter-Rams mechanical). Could read as
slightly stiff. Soft quadratic `Q` curves with the same endpoints would
feel smoother and arguably aid visual tracing on long vertical drops. Try
both behind a quick A/B; my bias toward elbows is aesthetic, not empirical.

### 7.5 Where names live relative to person-card bars
Personal-name INSIDE the bar (if bars were wide enough) vs. BELOW. I went
BELOW because stub widths are fixed at 56 px — too narrow for most first
names at 13 px. But terminal ledger cards have ample room; settle name
placement THERE per font availability, not in stubs at all.

### 7.6 Reason tooltip mechanism for adjustments
The adjustment reason currently surfaces only in the server-side log, not
in `DistRow` necessarily (verify in db.ts adjustment code path before wiring).
If unavailable, omit the `⚠ {reason}` clause from §4 step 2 and surface a
plain "adjusted" marker only. Do NOT fabricate a generic placeholder.

### 7.7 Global `▸ show redirections` toggle vs per-person activation
I specified both (per-person ⚠ PLUS global toggle). Possibly redundant;
either alone suffices. Pare back to ONE if screen real estate feels tight
during build. My preference if forced: keep per-person only — it preserves
focus on the specific exception the user came to investigate.

### 7.8 Determinism of `foh` vs `bar` carving order
Math permits either sequence (kit → bus → bar → foh OR kit → bus → "fOh &
bar treated in parallel"). The CALCULATOR carves bar before resolving foh
as the residue, so the diagram echoes that — sequential carving. A pedant
might argue bar should split out BEFORE the residual declaration reads as
arithmetic-imprecise. Trust the calculator; do not reorder.

### 7.9 Whether to honor in-viz correction when `cc_fees_cents !== gross × ccFeeRate` (post-rounding)
Due to `toDollars` rounding the fee, the displayed fee may differ slightly
from `gross × rate`. I did not add a small "≈" indicator next to the fee
caption, but the honest designer might. Decide whether to expose that
discrepancy or honor the post-rounded value silently. Calculator ships
post-rounded; mimicking it exactly is defensible.

### 7.10 Locale of numerals
I assumed en-US (period decimals, comma thousands, `$` sign). The app
clearly assumes USD throughout (busserRateCents "$20"). If localization
ever lands, the spec needs revisiting — I am not freezing that assumption
here; it inherits whatever `formatCents` does today.

---

## MOOD

It should feel like a bank statement rendered by Dieter Rams: confident,
transactional, slightly mechanical, profoundly unconcerned with charming
you. Numbers stand up straight, pools declare themselves in a single
colour, connectors elbow their way across the canvas with no flourish,
and the page asks nothing of the user except to be read. A tired server
taps the toggle at 11 PM, scans three descending strata — gross became
this, this branched into those, those landed on these people — and exits.
They are not entertained; they are informed. The diagram's job is to be
correct in five seconds and silent thereafter, the same way a weighing
scale displays a weight and then asks nothing further. Trustworthy not
because it is pretty but because nothing in it wastes your attention.
