# AI Co-Founders Experiment

An observation harness for giving Claude, GPT, and Gemini joint, autonomous
authority to decide what business to start and how to run it -- as
themselves, not personas, with no human steering turn-by-turn. See the
project's design conversation for the full context on why this is scoped
the way it is.

Hard boundary baked into the app, independent of anything the agents
decide: there is no tool anywhere in this codebase that contacts a real
person, company, or platform. No outbound email, no social posting, no
domain registration, no payments. Whatever "the business" turns out to be,
everything the agents produce is simulated collateral for a human
researcher to read.

## How it works

- A **Run** has three **Agents** (Claude / GPT / Gemini) that take turns in
  a fixed round-robin, each seeing the full transcript so far.
- Every turn requires naming the biggest weakness in the current leading
  proposal before an agent is allowed to signal agreement -- a structural
  check against multi-agent sycophancy, not just a prompt request to "be
  critical."
- Phases run in order: **IDEATION** (what business to start) ->
  **ROLE_ASSIGNMENT** (who does what) -> **OPERATION** (running it).
  Ideation and role assignment resolve either by consensus (all three
  signal ready) or, after a round cap, a forced majority vote with
  dissent recorded.
- A Vercel Cron job calls `/api/cron/tick` on a schedule; each call
  advances every `ACTIVE` run by exactly one turn (or one budget/consensus
  housekeeping step). Nothing runs continuously -- there's no long-lived
  process, just a tick.
- Spend is tracked per agent against its own budget cap, and against a
  total run cap, from actual token usage × admin-entered pricing. An
  agent that hits its cap is benched (excluded from rotation) but its
  turns stay in the transcript; the run stops once fewer than two agents
  remain active or the total cap is hit.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Vercel Postgres / Neon, or any Postgres) |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` -- encrypts provider API keys at rest |
| `ADMIN_PASSWORD` | The password for `/admin/login` |
| `ADMIN_SESSION_SECRET` | `openssl rand -hex 32` -- separate from the password, becomes the session cookie |
| `CRON_SECRET` | `openssl rand -hex 32` -- Vercel Cron sends this as a bearer token; the tick route rejects any request without it |

## Local development

```bash
npm install
npx prisma migrate dev --name init   # creates the schema in DATABASE_URL
npm run dev
```

Visit `http://localhost:3000` -- it redirects to `/admin`, which the proxy
(Next's current name for middleware) gates behind `ADMIN_PASSWORD`.

To advance a run manually without waiting for cron, hit the tick endpoint
yourself:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

## Deploying to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Set the environment variables above in the Vercel project settings.
   Provision Postgres (Vercel Postgres, or bring your own Neon/Supabase)
   and point `DATABASE_URL` at it, then run
   `npx prisma migrate deploy` once against that database.
3. Deploy. `vercel.json` registers the cron job automatically.
4. **Cron frequency and plan limits**: Vercel Cron Jobs have historically
   restricted the Hobby plan to once-daily schedules regardless of the
   cron expression in `vercel.json`, with more frequent schedules
   available on Pro -- confirm current limits in your Vercel dashboard, since this
   couldn't be verified live while building (network egress to
   vercel.com was blocked in the build environment). If you're on Hobby
   and want the experiment to actually move along, either upgrade, or
   point an external scheduler (a GitHub Actions cron workflow,
   cron-job.org, etc.) at `/api/cron/tick` with the `Authorization:
   Bearer $CRON_SECRET` header instead of relying on `vercel.json`.
5. A custom domain can be attached at any time after deploying to the
   default `*.vercel.app` URL -- no need to buy one before you're ready.

## First run checklist

1. Log in at `/admin/login`.
2. Go to **Settings** and configure all three providers: API key, model
   ID, and input/output price per million tokens. Pricing is admin-entered
   rather than hardcoded, since rate cards change often -- each provider's
   pricing page is linked from the settings form; confirm the current rate
   there before saving; the current model-ID suggestions are worth double
   checking too, especially for OpenAI and Gemini which move fast.
3. On the **Runs** page, set a per-agent budget, a total budget cap, and a
   round cap per phase (how many full rotations before a stuck decision
   is forced to a vote), then create the run.
4. Click **Start**. The next cron tick (or a manual curl, see above) takes
   the first turn.
5. Watch it at `/runs/<id>` -- it auto-refreshes every 20s while the run
   is active.

## Known v1 limitations

- **OpenAI and Gemini web-search tool shapes are unverified against live
  docs.** Network egress to `platform.openai.com`, `ai.google.dev`, and
  `openrouter.ai` was blocked while building this, so the research-tool
  type strings (`web_search_preview` for OpenAI, `googleSearch` for
  Gemini -- the latter confirmed against the installed SDK's own type
  definitions, the former not) should be smoke-tested against a real key
  before a full autonomous run. A failure there is handled gracefully
  (logged, turn continues without research) rather than crashing, but
  it's worth knowing before you trust the research feature is actually
  firing.
- **Consensus detection trusts each agent's own `readyToDecide` signal**
  rather than semantically verifying the three of them actually converged
  on the same specific proposal. If they all say "ready" while quietly
  meaning different things, the extraction step (a small Claude Haiku call
  that reads the transcript and reports what was agreed) is the only
  backstop.
- **A forced majority vote on ROLE_ASSIGNMENT** records the winning
  position as text but doesn't parse it back into structured per-agent
  role assignments the way a consensus resolution does. Deadlock lasting
  the full round cap on role assignment specifically is the rare edge
  this affects.
- **The admin/viewer password is shared.** `/runs/*` currently reuses the
  same session as `/admin/*`. Fine for a single operator; if this ever
  gets shared more broadly, split it into a separate viewer-only
  credential that doesn't also grant Settings access.
