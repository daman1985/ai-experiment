# Design system reference — AI Co-Founders Experiment

This is the standing source of truth for the app's visual and interaction
design. It exists so design decisions stay consistent from the first
component to the last, across sessions, without re-deriving everything
from scratch each time. The `ui-ux-designer` subagent (see
`.claude/agents/ui-ux-designer.md`) owns keeping this file current.

## What this app actually is

Three AI agents (currently Claude, GPT, Gemini — the roster is
provider-configurable, see `src/lib/agents/providerRegistry.ts`) take
turns in a round-robin discussion, deciding what business to start, then
who does what, then running it. A human admin watches. Current screens:

- **Login** (`/admin/login`) — single shared password.
- **Dashboard** (`/admin`) — list of runs, a form to create one (pick
  which providers join, budgets, round cap).
- **Settings** (`/admin/settings`) — one form per configured provider
  (API key, model ID, pricing).
- **Run viewer** (`/runs/[id]`) — the actual product: a header (status,
  phase, per-agent spend), a Decisions section, a collapsible Artifacts
  section, and the **Transcript** — a chronological feed of turns, each
  with a speaker, a message, a mandatory stated self-critique, and
  status badges (ready-to-decide / vote / yield).

The transcript is the core of the product. Nothing else in this app has
a real precedent in any reference product we've studied — a
multi-speaker AI conversation with a mandatory self-critique field,
votes, yields, and agent-produced documents doesn't exist in Linear,
Attio, Mercury, or Granola. Treat every other screen (dashboard,
settings) as a supporting cast to that one.

Stack: Next.js 16 (App Router), Tailwind v4 (CSS-first `@theme` config
in `src/app/globals.css`, not a `tailwind.config.js`), TypeScript,
deployed on Vercel.

Current state as of this doc: dark theme (`neutral-900`/`neutral-950`),
no token system, ad hoc Tailwind utility classes per component,
symmetric card grids. The admin (Daman) has explicitly said this reads
as generic/AI-generated and wants a light theme with real personality.

## Source quality — what to trust and what to discount

Three research passes fed this doc: a personal research vault (a
different, MCP-host-embedded product's research, only partially
applicable — see below), and two independently-run "deep research"
reports (referred to here as **Report G** and **Report O**), plus direct
visual inspection of two real products.

**Trust these at face value:**
- Direct visual inspection of Mercury's live public demo
  (`https://demo.mercury.com/`) — we looked at it ourselves, screenshot
  in hand. This is the single most reliable piece of evidence in this
  doc because it's the actual product, not a description of one.
- Report G's citations that point to a product's own first-party
  documentation/blog (Linear's own redesign post, Attio's own help
  docs, Mercury's own blog) — Report G consistently separates its own
  synthesis from sourced claims, which is a meaningful quality signal.
- The convergence itself: where the vault research, Report G, and
  Report O all independently landed on the same conclusion (see
  "Converged principles" below), treat that as strong evidence
  regardless of any one source's individual reliability.

**Discount or verify before relying on:**
- Report O's specific numeric claims about Linear (exact hex `#5e6ad2`,
  background `#08090a`, font weight exactly `510`, OpenType features
  `cv01`/`ss03`) — traced to `github.com/soulcore-dev/soul-design-md`,
  which is a third party's *reverse-engineered guess* at Linear's design
  system, not Linear's own documentation. Treat these numbers as
  "plausible inspiration," never as fact to cite or replicate exactly.
- Report O's Attio citations — Dribbble shots by an outside designer
  ("Julian Herbst"), not confirmed shipped product. Dribbble is
  routinely full of unsolicited concept redesigns for real companies.
- We inspected Linear's own redesign blog post directly and found it's
  dark-themed end to end (the blog chrome and every embedded product
  screenshot). This confirms Report G's own caveat: **Linear is a
  reference for structural/interaction discipline only — chrome
  hierarchy, panels, density — never for color or visual mood.** We have
  no direct visual evidence of what Linear's light mode (if any) looks
  like.
- Anything from the personal research vault tagged as belonging to the
  unrelated "Who App" (an MCP-host-embedded people-finder) — its
  sandboxed-iframe/`sendMessage`/host-reasoning-rendering material is
  for a fundamentally different architecture (an app embedded inside
  Claude/ChatGPT's own UI) and does not apply to this conventional
  server-rendered Next.js app.

## The mechanism-vs-skin split (read this before making any decision)

This is the most important operating principle in this document, and it
exists because of a real risk that was caught mid-conversation: treating
"the best real example we found" (Mercury) as a template to reskin,
rather than as proof that certain *mechanisms* work.

**Borrowed as craft, not style — settled, build these without asking:**
These converged across all sources (vault research + Report G + Report O
+ direct Mercury inspection) and have nothing to do with any one
product's brand. They're closer to "how good software is built" than to
anyone's visual identity.

- A real token substrate (spacing/color/type/elevation) before any
  component — no hardcoded px or hex in component code.
- One accent color, used for interactive/actionable signals only —
  never for static text, decorative borders, or more than one thing
  competing for attention on a screen at once.
- `font-variant-numeric: tabular-nums` on every numeric display (spend
  figures, budgets, timestamps, token counts).
- Status conveyed redundantly — icon + muted background + text label
  together, never color alone (this is also a WCAG requirement, not
  just a taste preference).
- Borders over shadows for ordinary separation; shadows reserved for
  things that actually float above other content (menus, dialogs,
  popovers).
- Cards/rows in the same visual row do not need identical internal
  anatomy — in fact they read better when they aren't identical
  (Mercury's Credit Card / Bill Pay / Invoicing row is the concrete
  proof: three different internal layouts, one shared container style).
- A squint-test budget: roughly ≤6 distinct visual objects above the
  fold, ≤2 chromatic colors per screen beyond the neutral scale, don't
  repeat an identical chrome pattern more than ~3 times before breaking
  it.
- Progressive disclosure for secondary information/settings — advanced
  options behind a disclosure, not all visible at once.
- Motion as feedback, not decoration: 80–250ms, ease-out, restricted to
  `opacity`/`transform`, honoring `prefers-reduced-motion`. Never
  persistent/looping motion on a steady-state element (e.g. a
  perpetually pulsing "running" badge becomes noise, not signal).
- Accessibility basics: WCAG AA contrast, `:focus-visible` rings on
  every interactive element, `aria-live="polite"` (never `assertive`)
  for feed updates, batched/throttled rather than announcing every
  token, real keyboard navigation (see below).
- The transcript is a continuous aligned reading surface (fixed left
  edge, consistent column positions for time/speaker/message/status),
  not chat bubbles. An administrator reading for a long session needs
  their eye to return to the same horizontal position every time — chat
  bubbles fail this by design.
- Live-feed behavior: append-only, never reorder history, never steal
  the viewport from someone scrolled up reading backlog — show an
  anchored "N new — jump to live" control instead.

**Decided:**

- **Accent color: deep teal/petrol** — starting hex `#0F6B67` (dark
  enough to also work as text/icon color at full opacity, not just a
  button fill; tune visually once rendered, this is a starting point
  not a final measurement). Reserved exclusively for interactive/
  actionable signals — primary buttons, active nav state, focus rings.
  Never used for static text, decorative borders, or agent identity.
- **Typeface pairing: serif headers + clean sans body.** Headers/titles/
  section labels in **Newsreader** (Google Fonts, genuinely editorial —
  designed for online publication contexts, more character than the
  more neutral Source Serif 4). Transcript body, controls, and data
  stay in **Geist Sans** (already in the project via `next/font/google`).
  Monospace stays Geist Mono, reserved per the engineering specs above
  (technical identifiers only, never all metadata).

- **Agent identity: three-opacity-tier color per agent, plus a circular
  avatar icon.** Each agent gets one low-saturation hue (full opacity on
  name label, 6% row background wash, 20% border — the vault research's
  exact mechanism) *and* a small circular avatar icon so identity never
  depends on memorizing which color is which. Admin's explicit call:
  the provider's real logo in the circle is acceptable for now, since
  the app is private and password-gated. Revisit if the app is ever
  made public — displaying real trademarked marks on a page whose
  premise is "these companies' models run a fictional company" reads
  differently once it's not just for one person to see. Implementation
  detail (real logo vs. a tasteful approximation per provider) to be
  resolved during the build phase, not blocking here.
- **Weakness-critique field: marginalia treatment.** A thin rule or
  bracket to the left of the critique text, set in a slightly different
  type treatment (italic or a lighter weight) than the main message —
  reads as the agent stepping outside its own statement to annotate
  itself. Always visible, never hidden behind a disclosure.
- **Decision moment (consensus/forced vote): full-width break in the
  feed.** A deliberate interruption of the normal turn rhythm — like a
  chapter divider — marking that something resolved. Uses the "break a
  repeated chrome pattern intentionally" idea from the squint-test rule,
  applied on purpose at a genuinely significant moment rather than by
  accident.
- **Artifacts: both.** An inline preview card (title + first line,
  expandable) appears in the transcript at the moment of creation, the
  existing separate collapsible Artifacts section stays, and that
  section gets richer grouping (by phase, linked back to the producing
  turn).
- **Signature motif: turn-order stepper.** Small marks for each active
  agent, current position highlighted. Does double duty as the
  practical "whose turn is it" indicator (linear, not a graph — per the
  node-graph research finding) and as the one deliberate personality
  touch in the shell.

All "ours to invent" decisions are now resolved as of this pass. Any
new one that comes up during implementation should be added here and
brought to the admin the same way, not decided in code.

## Implementation status

**Phase 1 (token foundation) is done**, in `src/app/globals.css` (`@theme
inline` block) and `src/app/layout.tsx` (Newsreader font). Verified: a
throwaway test page confirmed every overridden utility (`rounded-md`,
`rounded-sm`, `rounded-xl`, `font-serif`, `bg-accent`,
`text-agent-claude`) compiles to the exact intended value, not just that
the build succeeds. No component has been updated to consume these yet
— the app still looks like the old dark theme visually. That's Phases
2-4 (shared primitives, then Settings/Dashboard, then the Transcript).

Spacing and motion deliberately do **not** have custom tokens — Tailwind
v4's own default spacing scale (0.5/1/2/3/4/6/8/10/12 → exactly
2/4/8/12/16/24/32/40/48px) and duration scale (100/150/200ms) already
match what's specified below almost exactly. Use those stock utilities
directly rather than inventing parallel ones.

## Engineering specs (safe to build against directly)

**Spacing.** Use Tailwind's stock scale directly — `p-0.5`/`gap-1`/
etc. map to `2 / 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48`px, matching this
exactly. No custom spacing tokens (see Implementation status above).

**Type scale** (typeface: Newsreader serif for headers via `font-serif`,
Geist Sans for body/data as the default `font-sans` — decided above):

| Element | Size | Line-height | Weight |
|---|---:|---:|---:|
| Transcript body | 15px | 1.5–1.6 | 400 |
| Speaker name | 13–14px | 1.35 | 500–600 |
| Controls | 13–14px | 1.3 | 500 |
| Metadata | 12–12.5px | 1.35 | 400–500 |
| Screen title | 20–22px | 1.25 | 600 |
| Dashboard stat | 24–28px | 1.15 | 600 |

Monospace only for genuinely technical identifiers (model IDs, raw tool
call arguments) — never for all metadata just because this is an AI
tool.

**Radius discipline** (avoid uniform-8px-everywhere) — implemented as
Tailwind's own `rounded-*` scale, overridden in `globals.css`:

```
rounded-sm    5px   badges
rounded-md    6px   ordinary controls
rounded-lg    8px   popover/menu, major dashboard panel
rounded-xl    10px  dialog
rounded-none  0px   transcript row, table row (continuous surface, not cards)
```

**Motion tokens:**

```
hover/focus              80–120ms
badge/state transition   120–160ms
popover                  120–160ms
inspector/drawer         160–220ms
new live event           ~120ms, opacity+translateY(2px)→0, only while following live
```

**Layout.** Transcript column width constrained to a comfortable reading
measure (~65–75 characters, roughly 640–720px), not full-bleed on a wide
monitor — expand whitespace or reveal a metadata inspector instead of
stretching the reading column.

**Long-transcript performance/accessibility** (relevant once a run has
many turns): virtualize the list once it's long, but if you do, you must
add `aria-setsize`/`aria-posinset` on rendered rows so screen readers
still understand the true document length — a naive virtualized list
tells a screen-reader user the transcript is only as long as what's
currently mounted. Use a roving `tabindex` (one row is `0`, the rest
`-1`) rather than making every row individually tab-stoppable.

## Explicit rejections (both reports and the vault agree — do not import)

WebGL/3D/shader backgrounds, glassmorphism/heavy blur on reading
surfaces, kinetic/morphing typography, spring/bounce motion physics,
decorative bento grids for the transcript, custom cursors, scroll-jacking
or parallax (scroll position is semantically meaningful here — it's your
place in the chronology, never repurpose it as an animation trigger),
animated gradient/mesh backgrounds, a card for every single message.
These aren't just "currently unfashionable" — both deep-research reports
independently flagged them as actively harmful to a dense, long-session
reading tool regardless of trend cycles.

## Working process for this subagent

1. When asked to plan or build anything UI-related, check the relevant
   section of this doc first.
2. Never unilaterally decide anything in the "ours to invent" list —
   surface it as an explicit question back to the main session/admin.
3. When a new decision gets made (an "ours to invent" item gets
   resolved, or a new pattern gets adopted), update this file in the
   same piece of work — this doc drifting out of date is a failure mode
   to actively avoid.
4. Flag drift: if a new component is about to break an already-settled
   pattern (a new symmetric card grid, a new shadow-heavy treatment,
   inconsistent radius), say so before building it, not after.
