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
- Padding/margin on a box is symmetric by default (`px-4` not
  `pl-4 pr-1`) — an asymmetric value needs a deliberate reason (e.g. a
  marginalia rule that's genuinely meant to hang off one edge only,
  like the weakness-critique left border) and should read as an
  obvious exception, not a typo. Caught as a real bug in `TurnRow`
  (`pl-4 pr-1`, fixed to `px-4`) during a design QA pass — worth
  actively scanning for when reviewing any new component.
- Numeric/enum formatting goes through the shared helpers
  (`fmtUsd`/`formatPhase` in `src/lib/format.ts`), never re-implemented
  inline per screen — caught the Dashboard hand-rolling
  `.toFixed(4)`/`.toFixed(2)` (inconsistent precision vs. the run
  viewer's `fmtUsd`) and printing the raw `Phase` enum instead of
  `formatPhase()` during the same pass.
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
the build succeeds.

**Phase 2 (shared primitives) is done** — `Button`, `Input`, `Card`,
`Badge` in `src/components/ui/`, proven out on `/admin/login`. Verified
visually via Playwright screenshots (normal + error state).

**Phase 3 (Settings + Dashboard) is done** — `src/app/admin/(protected)/
layout.tsx`, `page.tsx` (Dashboard), and `settings/page.tsx` now consume
the primitives and tokens exclusively; no hardcoded `neutral-*` dark
classes remain in any admin-authenticated screen. Run status (`ACTIVE`/
`PAUSED`/`STOPPED*`/`COMPLETED`) maps to `Badge` variants
(success/warning/error/accent) instead of raw text-color classes.
Verified visually via Playwright screenshots of both pages, logged in
against a real run with real provider keys configured.

**Phase 4 (the Transcript/TurnCard) is done** — `src/app/runs/[id]/
page.tsx` and `src/components/transcript/` (`AgentAvatar`, `TurnStepper`,
`PhaseDivider`, `DecisionBreak`, `ArtifactInlinePreview`, `TurnRow`).
Notes on how each "ours to invent" decision landed in code:

- Transcript rows are a continuous surface (`rounded-none`, `border-b`
  between rows, no per-message card), not chat bubbles — matches the
  explicit rejection of "a card for every single message."
- Agent identity: added `src/lib/agents/agentColor.ts` with the
  three-opacity-tier classes (full-opacity name label, 6% row wash, 20%
  left rule) as literal Tailwind strings per provider, plus a circular
  avatar. Avatars use a two-letter initial on a tinted background rather
  than the provider's real logo — a placeholder "tasteful approximation"
  (the doc's own phrase for the unresolved implementation detail), since
  no logo assets are in the project and fetching third-party brand marks
  wasn't worth the trademark question for a first pass. Revisit if/when
  real logos matter more than avoiding that question.
- Weakness critique: always-visible marginalia — left rule in the
  agent's own color at 30%, italic text, directly under the message.
- Decision moment: turns and decisions are now merged into one
  chronological feed (by `createdAt`/`decidedAt`) instead of decisions
  living in a separate section before the transcript — the "full-width
  break" is a real break in the actual feed, not a lookalike section
  above it. `Decision.dissent` (agent ID + reason) is resolved back to
  display names for readability instead of raw JSON.
- Artifacts: both, as decided. Schema gained `Artifact.turnId` (new
  migration `add_artifact_turn_link`) so an artifact can be traced back
  to the turn that produced it — `engine.ts` now captures the created
  turn's id and sets it. Inline preview appears on that turn
  (title + first line, expandable via `<details>`); the bottom Artifacts
  section is grouped by phase and links back to the transcript position
  when a `turnId` exists (pre-migration artifacts just won't have the
  backlink).
- Turn-order stepper: small dots in the header, current speaker
  highlighted in that agent's color. "Current" is computed with the same
  `turnsInPhase % activeAgents.length` rotation math as `engine.ts`
  (including the pending-yield override), so the stepper never drifts
  from what will actually happen on the next cron tick.
- Artifact and turn content render in `font-sans`, not the browser's
  default monospace for `<pre>` — reserving monospace for genuinely
  technical identifiers per the engineering spec, not generated prose.

Verified visually via Playwright against a real run with real turns,
yields, and an artifact; a synthetic `Decision` row was inserted and
then removed from the local dev DB purely to check the decision-break
rendering (this run has none yet).

**Phase 5 (motion/accessibility) is done** — replaced `src/app/runs/
[id]/AutoRefresh.tsx` (deleted) with `src/components/transcript/
LiveTranscript.tsx`, which now owns the 20s poll plus everything the
live feed needs to behave well for a long-running session:

- **`aria-live="polite"` announcements**: a dedicated visually-hidden
  (`sr-only`) live region, kept separate from the visible feed so
  unrelated re-renders never trigger spurious announcements. Only the
  diff between polls is announced (e.g. "New turn from Claude", or "N
  new updates in the transcript" when a batch lands at once) — never the
  whole transcript re-announced on every refresh.
- **"N new — jump to live"**: `LiveTranscript` tracks "following live"
  (within 120px of the bottom of the document) via a scroll listener,
  independent of the poll. If new items arrive while following live, the
  page auto-scrolls to keep them in view; if the admin is scrolled up
  reading backlog, nothing moves — a fixed, accent-colored pill appears
  instead ("N new — jump to live") that scrolls to bottom on click. This
  is a literal implementation of the already-decided "never steal the
  viewport" bullet under Borrowed craft, not a new decision.
- **New-live-event motion**: `NewItemFade` (in the same file) wraps each
  feed item and decides once, at mount time, whether to animate — using
  React's own mount timing rather than timestamps: every item present at
  initial load mounts before the "initial load is done" ref flips true,
  so it never animates; only items whose component instances are created
  by a later `router.refresh()` are eligible, and only if the admin was
  following live at that moment. Motion is the exact token from the
  Motion tokens table (`--animate-turn-enter` in `globals.css`, 120ms
  ease-out, opacity + `translateY(2px)` → 0).
- **Roving tabindex / keyboard nav**: `TurnRow` and `DecisionBreak` are
  now `role="article"` with `aria-posinset`/`aria-setsize` (ready for
  virtualization later) inside a `role="feed"` section. One article is
  `tabIndex=0` at a time; `LiveTranscript` maintains that invariant via
  focus-event delegation (so both arrow-key movement and a direct click
  land correctly) and moves focus with ArrowUp/ArrowDown.
- **Focus-visible states**: turn/decision rows get an inset accent ring
  (`focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-
  accent` — inset because these are edge-to-edge rows, not discrete
  controls, so a normal offset ring would clip); the artifact
  `<details>/<summary>` disclosures (both the inline transcript preview
  and the bottom Artifacts section) and the "View in transcript" link
  all got the same ring treatment as `Button`/`Input`.
- **`prefers-reduced-motion`**: handled via Tailwind's `motion-safe:`
  variant on the entrance animation class, confirmed in the compiled CSS
  to be wrapped in `@media (prefers-reduced-motion: no-preference)` — no
  JS media-query branching needed. The JS-side "should this item
  animate" decision and the CSS-side "is motion actually allowed"
  decision are intentionally separate concerns.

Verified with Playwright against the real run (`Test run 1`): inserted
throwaway `Turn` rows via `psql` while the page was open (both scrolled
to bottom and scrolled to top), waited out a real 20s poll cycle, and
confirmed — auto-scroll + no pill when following live; pill with correct
count + no scroll when reading backlog; roving tabindex/`aria-posinset`/
`aria-setsize` values and ArrowDown focus movement; the entrance
animation class present with `animation-name: none` computed under
`prefers-reduced-motion: reduce`; and that items already on the page at
load time never receive the animation wrapper at all. All throwaway rows
were deleted afterward (`Test run 1` is back to its original 4 turns).

Remaining: Phase 6 (real-content validation once a run produces enough
transcript to stress-test the layout for real).

**Design QA pass (bug-fix level) done** across all four screens at
375/768/1280/1600px via Playwright: fixed `TurnRow`'s asymmetric
`pl-4 pr-1` (see the new "Borrowed craft" bullet above), a stray
`</span>: ` line-break that happened to read fine in the DOM but was
worth double-checking, and two Dashboard formatting inconsistencies
(hand-rolled `.toFixed()` instead of `fmtUsd`, raw `Phase` enum instead
of `formatPhase()`) against the run viewer. Also fixed: the Dashboard's
"New run" budget/round-cap fields were a hard `grid-cols-3`, which wraps
label text ("Per-agent" / "budget ($)") awkwardly at ~375px — now
`grid-cols-1 sm:grid-cols-3`.

**Open question, explicitly not decided here: does the current
execution clear "genuinely next-level," or only "clean and
consistent"?** The admin's original ask (see top-level framing) was
"best of the best in the industry, cutting edge" — a higher bar than
bug-free. Honest read after this pass: every screen is now internally
consistent and free of the sloppiness class of issue (alignment,
spacing, formatting, responsive wrapping), but the overall visual
execution reads closer to "a well-built, tasteful light-theme SaaS
app" than to something a design-forward reviewer would call
distinctive on sight. The likely levers, in rough order of leverage,
if the admin wants to invest further (none of these are decided —
surfacing them, not choosing one):
- The teal accent + Newsreader/Geist pairing is tasteful but is also
  close to a fairly common "editorial SaaS" combination right now
  (serif display + neutral sans, one muted jewel-tone accent) — it
  doesn't yet feel unmistakably *this app's*.
- The decision-break moment (the one spot the doc explicitly asks to
  read as a deliberate interruption) currently uses `bg-surface-hover`,
  which is very close in value to the canvas background — at a glance
  it barely reads as a break at all. This is a case where the
  *mechanism* (full-width break in the feed) is right per the doc, but
  the current visual weight undersells it.
- The turn-order stepper — the doc's own "one deliberate personality
  touch" — renders as 8–10px dots that are easy to miss entirely at
  normal viewing distance; it's currently more decorative footnote
  than a genuine signature motif.
- On wide viewports the transcript column sits in the middle of a lot
  of flat, empty canvas on both sides — correct per the "don't stretch
  the reading column" rule, but the doc also floated a metadata
  inspector as the alternative use of that space, and that was never
  built. Right now the whitespace reads as "unfinished" rather than
  "deliberate," on close inspection.
None of these are bugs and none were changed in this pass — they're
subjective-direction calls squarely in "ours to invent" territory, so
they're recorded here for the admin to weigh in on rather than acted on
unilaterally.

**Topic generalization + anti-sycophancy protocol upgrade done.** Mostly
architecture/engine work, not visual design, but touches enough UI to
log here:

- The fixed `IDEATION`/`ROLE_ASSIGNMENT`/`OPERATION` enum is gone,
  replaced by an admin-defined, ordered `RunPhase` list per run (name,
  guidance text, round cap, and two opt-in flags: `assignsRoles`,
  `allowsResearch`). The Dashboard's New Run form now asks for a
  `topic` (free text — what the room actually discusses, previously
  hardcoded to "start a business") plus up to 5 phase slots, pre-filled
  with the original business-founding template as an editable default
  rather than the only option. A phase with no name is skipped. The run
  viewer's phase header/divider/artifact grouping now read the phase's
  real `name` directly instead of a formatted enum value.
  A single-phase topic (e.g. a plain debate with no "execute" stage)
  now has a real completion path — `advanceToNextPhase` marks the run
  `COMPLETED` when there's no next phase, instead of the old behavior
  where the last phase never resolved to anything and just ran until
  the budget ran out.
- Cross-run isolation was verified, not just assumed: read every
  provider adapter and the prompt builder directly — all three API
  calls are stateless per turn, context comes only from that run's own
  stored turns, and no conversation/thread/session object is used
  anywhere. Nothing needed to change here; already true by construction.
- Anti-sycophancy protocol changes, sourced from the September 2026
  model-selection research pass: agents now address each other by a
  per-run pseudonym (`Agent A`/`B`/`C`, from seat index) instead of
  their real provider identity — evidence suggests revealing which lab
  built a peer introduces identity-driven authority/conformity effects
  independent of argument quality. The admin-facing UI is completely
  unaffected — avatars, names, and colors everywhere still show real
  identity, since that's what the human observer is actually watching
  for. Turns now also carry `confidenceBeforePeerUpdate`/
  `confidenceAfterPeerUpdate` (0.0-1.0, self-reported, never replayed
  back into peer context so it can't become something to conform on) —
  shown in `TurnRow`'s metadata line as `confidence 0.55→0.70`, and
  intended as the substrate for a future decision-map view that can
  distinguish independent judgment from peer-driven conformity. Votes
  cast during a forced-vote round are no longer shown to other agents
  in the same round (`formatTranscript` announces "[cast a vote]"
  without the choice) — a real secret ballot, not just phrasing, since
  a phase's transcript never survives past its own resolution. The
  starting speaker also now rotates by round rather than always being
  seat 0, removing a permanent first-mover anchoring advantage.
- Model roster updated to `claude-sonnet-5` / `gpt-5.6-terra` /
  `gemini-3.8-flash` (`providerRegistry.ts` model hints and pricing
  URLs), the roster both September 2026 research reports converged on
  independently despite disagreeing on some specifics. Verified
  directly rather than trusting either report: fetched Anthropic's
  pricing page myself (Sonnet 5 confirmed $2/$10), and the admin
  independently fetched OpenAI's and Google's current pricing pages,
  which resolved the one real contradiction between the two reports —
  Gemini 3.8 Flash is $0.75/$3.75 through Dec 31 2026 (one report's
  number), not $1.50/$7.50 "currently" (the other report's number,
  which turned out to be the *post*-promotional 2027 rate). OpenAI's
  adapter migrated off the legacy `web_search_preview` tool to the
  current `web_search` tool to match. Anthropic's adapter now caps
  research to one direct search (`max_uses: 1`, `allowed_callers:
  ["direct"]`) per the research's 60-second-timeout latency guidance.
  Still unverified either way (blocked network egress on both sides of
  this conversation): whether `gemini-3.8-flash` can combine
  `googleSearch` and `responseSchema` in one call — `gemini.ts` keeps
  its conservative two-call path until that's tested against a real
  key.

Verified with tsc, a full build, and direct DB/UI testing on local dev:
created a real run through the rebuilt form with a non-business topic,
confirmed the three phases and their flags landed correctly, then
inserted synthetic turns/a decision/an artifact spanning two phases via
psql to confirm phase-based grouping, the decision break, the confidence
display, and the artifact backlink all render correctly against real
(if synthetic) data. Not yet verified: an actual live turn against a
real provider key, since none are configured yet — that's the next real
test once the admin adds keys.

**Root-cause/pre-mortem reasoning pass done** — an "enhancing cognition"
style upgrade, requested directly by the admin: make the room's
discussions genuinely thorough rather than surface-level, without
falling into the trap of just adding another required per-turn JSON
field that a weak model could perfunctorily check. Two changes, at two
different layers:

- **Prompt layer** (`buildSystemPrompt`): the existing weakness-critique
  rule now explicitly asks agents to name the actual underlying need a
  proposal is supposed to solve, separate from the proposal's specific
  execution, before treating it as strong — not just find a surface
  nitpick. The `readyToDecide` gate now requires surviving a pre-mortem
  ("the single most likely way this fails in practice") before an agent
  is allowed to signal it's ready, mirroring the re-evaluation gate's
  "name the failure mode before finalizing" step.
- **Decision layer** (new, not prompt-only): a fourth extraction call —
  `extractRootCauseCheck` in `decisionExtraction.ts`, same cheap
  Claude Haiku tier as the existing consensus/role/vote extractions —
  runs once whenever a Decision is created (consensus or forced vote),
  reading the finished conversation as a skeptical outside reviewer and
  naming the single most significant untested assumption plus its most
  likely failure mode. Stored on `Decision.untestedAssumption` /
  `likelyFailureMode`, rendered in `DecisionBreak` right under the
  outcome. Deliberately admin-facing only, never replayed back into the
  agents' own prompt context — same reasoning as the confidence fields,
  so it can't become something an agent games or pre-empts. This is the
  layer that actually mirrors enhancing-cognition's structure (a gate
  applied once, at the moment something gets finalized) rather than
  diluting the per-turn schema further.

Verified with tsc, a full build, and a synthetic Run/Phase/Agent/
Decision inserted via psql (no real provider call, since this is pure
schema/rendering verification) — confirmed the "Untested: ... If
wrong: ..." annotation renders correctly under a decision break.

**Full autonomy, not admin-scripted phases (done, before the first real
run).** The free-form `RunPhase` model (Phase 9/10 above) still had the
admin pre-defining a sequence of named phases with directive `guidance`
text and a hard transcript reset at each boundary — a parameterized
version of the same scripted structure as the original fixed
IDEATION/ROLE_ASSIGNMENT/OPERATION enum, not actual autonomy. Caught
before spending real API budget on the first live run. `RunPhase` is
removed entirely: a run is now one continuous transcript from start to
completion, with no admin-authored stages or guidance beyond the topic
itself. What changed:

- **Schema**: `RunPhase` deleted. `Run` gained `forcedVoteRoundCap`
  (rounds since the last decision, or since the start, before a forced
  vote — a pacing dial, not content) and `allowsResearch` (one run-wide
  toggle). `Turn`/`Decision`/`Artifact` lost `phaseId`. `Decision` gained
  `afterSequenceNumber` (the run's max `Turn.sequenceNumber` at the
  moment it resolved) so the engine can compute "turns since the last
  decision" without any phase to scope by. `Turn` gained `runComplete`
  (mirrors `readyToDecide`'s pattern: reported every turn, checked only
  once `readyToDecide` is unanimous). `Agent.assignedRole` removed along
  with the `assignsRoles`/`extractRoleAssignment` special case — role
  assignment, if the room does it, is just conversation content now, not
  a structurally parsed field.
- **Prompt layer**: no more "Current phase: X. {guidance}" injection.
  Ground rules now state plainly that there's no predefined structure,
  stages, or admin-assigned roles beyond the topic, and that the room can
  reach more than one decision over a single continuous conversation —
  each `readyToDecide` consensus is recorded and the conversation
  continues, ending only when the room also signals `runComplete`.
- **Engine**: `checkConsensus`/`handleForcedVoteTurn` operate on the
  whole run, not a phase; the transcript sent to agents every turn is the
  full run history (never reset), so nothing is lost across decisions the
  way it was across phase boundaries. Round-cap/rotation math counts
  turns since the last `Decision.afterSequenceNumber` instead of since a
  phase start.
- **Admin form**: the 5-slot phase fieldset (name/guidance/round-cap/
  assigns-roles/allows-research per slot) is gone. New Run now asks only
  for name, topic, participants, budgets, and two mechanical dials
  ("Rounds before a forced vote", "Allow web search") — no content input
  beyond the topic itself.
- **Run viewer**: `PhaseDivider` deleted; the transcript renders as one
  continuous feed of turns and decision breaks with no phase headers, and
  the Artifacts section is a flat list instead of grouped by phase.

Verified with tsc, a full `next build`, and a Playwright screenshot of
the simplified New Run form (Runs → New run) confirming no phase/
guidance fields remain and the topic field is the only content input.

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
