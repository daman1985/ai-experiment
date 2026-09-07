"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logDiagnostic, logDiagnosticBatch } from "@/lib/diagnostics";
import { buildSystemPrompt, buildResearchPrompt, buildTurnPrompt } from "@/lib/agents/prompt";
import { turnOutputSchema } from "@/lib/agents/schema";
import { withTimeout } from "@/lib/agents/withTimeout";

// Wipes every recorded event so the next action's output is unambiguous
// -- otherwise fresh results sit above a growing pile of old ones and
// it's easy to mistake a stale error for a new one at a glance. Logs its
// own count/timestamp *after* clearing (the one deliberate exception to
// "this button empties the log") so a click that doesn't visibly do
// anything is instantly diagnosable: if this line doesn't appear, the
// click never reached the server at all (stale page, browser cache) --
// no need to guess.
export async function clearDiagnosticsAction(): Promise<void> {
  try {
    const { count } = await prisma.diagnosticEvent.deleteMany({});
    await logDiagnostic({
      source: "diagnose:clear",
      level: "info",
      message: `cleared ${count} event(s)`,
    });
  } catch (err) {
    // A DB outage here would otherwise crash this page with Next's
    // generic error screen -- on a page whose whole purpose is
    // self-diagnosis without infra access, that's exactly the failure
    // mode most worth surfacing as a normal log line instead.
    console.error("[diagnose:clear] failed:", err);
  }
  revalidatePath("/admin/diagnostics");
}

// A full diagnostic battery, run in one shot -- built after several
// rounds of one-variable-at-a-time checks each requiring their own
// deploy cycle, which was the right instinct (test one thing before
// guessing the next) but too slow in practice. What's confirmed so far,
// each independently and repeatedly, directly from this exact
// production runtime:
//   - Trivial system prompt ("You are a test.") + web_search tool, OR +
//     structured-output schema, OR neither: all succeed in 1-3s.
//   - The app's real system prompt (buildSystemPrompt output, ~5.7-7.3k
//     chars) + web_search tool, OR + structured-output schema: both hang
//     for their exact full timeout, every single time, regardless of
//     how large the surrounding user-message content is (a 123-char and
//     a 23,592-char turnText both hang identically).
// Not yet known: whether the real system prompt hangs completely on its
// own (no tools, no schema); whether it's the prompt's *length* or its
// *specific content* (never tested a long-but-unrelated prompt as a
// control); and if content, which half of it. This runs all of those in
// parallel so one click gives a complete answer instead of another
// single data point.
const CHECK_TIMEOUT_MS = 20_000;
// Every check using this timeout has succeeded in 1-5s; the two real
// research/turn calls have failed at exactly CHECK_TIMEOUT_MS every
// time they've been run, with zero variance, across dozens of real
// production attempts. That pattern is ambiguous between two very
// different problems with very different fixes: genuinely stuck
// forever (a platform-side defect, no timeout fixes it, avoid the
// triggering feature or escalate to Anthropic), or legitimately slower
// than 20s for this harder kind of request (a real web search
// round-trip, or genuinely original creative+critical reasoning for an
// opening turn) -- in which case the fix is just a longer timeout on
// these two specific calls in production. This extended budget, used
// only for those two, is what actually distinguishes the two.
const EXTENDED_CHECK_TIMEOUT_MS = 45_000;

interface CheckOutcome {
  label: string;
  ok: boolean;
  elapsedMs: number;
  detail: string;
  promptLength: number;
}

// Reuses the same withTimeout() the real provider adapters use (see
// lib/agents/withTimeout.ts) instead of a second hand-rolled
// AbortController+setTimeout implementation -- one guaranteed-timeout
// mechanism to keep correct, not two (a third copy already exists in
// the sibling /api/diagnose-anthropic route, which is its own temporary
// diagnostic slated for deletion; not worth threading this through that
// one too).
async function timedCall(
  label: string,
  promptLength: number,
  fn: (signal: AbortSignal) => Promise<string>,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<CheckOutcome> {
  const start = Date.now();
  try {
    const value = await withTimeout(fn, timeoutMs, label);
    return { label, ok: true, elapsedMs: Date.now() - start, detail: value, promptLength };
  } catch (err) {
    return {
      label,
      ok: false,
      elapsedMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
      promptLength,
    };
  }
}

// Benign, unrelated prose (nothing about autonomy, agents, or
// decision-making) repeated/truncated to match the real system prompt's
// length exactly -- a control for length vs. content: if a system
// prompt this long hangs regardless of what it says, that's a length
// effect; if only the real content hangs, it's specific to that text.
function buildFillerOfLength(targetLength: number): string {
  const paragraph =
    "The cultivation of tea traces back thousands of years, with early records describing how leaves were harvested by hand and dried under open sky. Over centuries, distinct regions developed their own methods of processing -- some favoring oxidation, others steaming the leaves quickly to preserve a brighter, grassier character. Traders carried these techniques along overland routes and later by sea, and each new region adapted the craft to its own climate and soil. Modern producers still debate the ideal altitude, the best time of day to pick, and how long to let the leaves rest before firing. ";
  let out = "";
  while (out.length < targetLength) out += paragraph;
  return out.slice(0, targetLength);
}

export async function runRealPromptCheckAction(): Promise<void> {
  try {
    await runBattery();
  } catch (err) {
    // Two realistic failures aren't caught by anything inside
    // runBattery: decrypt() throwing on an auth-tag mismatch (the
    // ENCRYPTION_KEY env var rotated or mismatched between
    // environments), and a DB outage on the initial config lookup. Both
    // would otherwise crash this page with Next's generic error screen
    // -- on a page whose whole purpose is self-diagnosis without infra
    // access, those are exactly the failures most worth surfacing as a
    // normal log line instead of a stack trace nobody without Vercel
    // access can read.
    await logDiagnostic({
      source: "diagnose:battery",
      level: "error",
      message: `battery crashed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  revalidatePath("/admin/diagnostics");
}

async function runBattery(): Promise<void> {
  const config = await prisma.providerConfig.findUnique({ where: { provider: "ANTHROPIC" } });
  if (!config) {
    await logDiagnostic({
      source: "diagnose:battery",
      level: "error",
      message: "no Anthropic provider config found",
    });
    return;
  }

  const apiKey = decrypt({ encrypted: config.encryptedApiKey, iv: config.iv, authTag: config.authTag });
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const modelId = config.defaultModelId;

  const realSystemPrompt = buildSystemPrompt({
    selfRoomLabel: "Agent A",
    otherRoomLabels: ["Agent B", "Agent C"],
    topic: "Decide what business to start, then who does what, then run it.",
    isForcedVote: false,
    forcedVoteRoundCap: 6,
    priorDecisions: [],
  });
  const researchPrompt = buildResearchPrompt([], "Agent A");
  const turnPrompt = buildTurnPrompt({ transcript: [], selfRoomLabel: "Agent A", researchNote: null, documents: [] });
  const trivialSystemPrompt = "You are a test.";
  const half = Math.floor(realSystemPrompt.length / 2);
  const realFirstHalf = realSystemPrompt.slice(0, half);
  const realSecondHalf = realSystemPrompt.slice(half);
  const fillerSameLength = buildFillerOfLength(realSystemPrompt.length);

  const webSearchTools = [
    { type: "web_search_20260318" as const, name: "web_search" as const, max_uses: 1, allowed_callers: ["direct" as const] },
  ];

  function bareCheck(label: string, system: string) {
    return timedCall(label, system.length, (signal) =>
      client.messages
        .create(
          { model: modelId, max_tokens: 50, system, messages: [{ role: "user", content: "Reply with just the word OK." }] },
          { timeout: CHECK_TIMEOUT_MS, signal },
        )
        .then((r) => r.content.find((b) => b.type === "text")?.text ?? "(no text)"),
    );
  }

  function toolsCheck(label: string, system: string) {
    return timedCall(label, system.length, (signal) =>
      client.messages
        .create(
          { model: modelId, max_tokens: 50, system, tools: webSearchTools, messages: [{ role: "user", content: "What is 2+2? Do not search, just answer." }] },
          { timeout: CHECK_TIMEOUT_MS, signal },
        )
        .then((r) => r.content.find((b) => b.type === "text")?.text ?? "(no text)"),
    );
  }

  const results = await Promise.all([
    bareCheck("trivial_bare", trivialSystemPrompt),
    toolsCheck("trivial_tools", trivialSystemPrompt),
    bareCheck("real_bare", realSystemPrompt),
    timedCall(
      "real_tools (full research call, 45s budget)",
      realSystemPrompt.length,
      (signal) =>
        client.messages
          .create(
            { model: modelId, max_tokens: 2000, system: realSystemPrompt, tools: webSearchTools, messages: [{ role: "user", content: researchPrompt }] },
            { timeout: EXTENDED_CHECK_TIMEOUT_MS, signal },
          )
          .then(() => "ok"),
      EXTENDED_CHECK_TIMEOUT_MS,
    ),
    timedCall(
      "real_schema (full turn call, 45s budget)",
      realSystemPrompt.length,
      (signal) =>
        client.messages
          .parse(
            { model: modelId, max_tokens: 2000, system: realSystemPrompt, output_config: { format: zodOutputFormat(turnOutputSchema) }, messages: [{ role: "user", content: turnPrompt }] },
            { timeout: EXTENDED_CHECK_TIMEOUT_MS, signal },
          )
          .then(() => "ok"),
      EXTENDED_CHECK_TIMEOUT_MS,
    ),
    bareCheck("real_first_half_bare", realFirstHalf),
    bareCheck("real_second_half_bare", realSecondHalf),
    bareCheck("filler_same_length_bare", fillerSameLength),
    toolsCheck("filler_same_length_tools", fillerSameLength),
    // The real system prompt alone succeeded, and a length-matched
    // unrelated filler + tools succeeded -- so it's not the system
    // prompt's length or content alone. These two isolate the remaining
    // question: does the real system prompt need to be paired with the
    // *real* accompanying message (which actually asks the model to use
    // the tool, or gives it real conversational content to react to), or
    // does it hang with tools/schema regardless of what the message says?
    toolsCheck("real_system_tools_trivial_message", realSystemPrompt),
    timedCall("real_system_schema_trivial_message", realSystemPrompt.length, (signal) =>
      client.messages
        .parse(
          {
            // 2000, not 50 -- the real turnOutputSchema needs room for a
            // full JSON object (message, weaknessCritique, two confidence
            // fields, several nullable fields, etc.); the first version
            // of this check used 50 and got a JSON-truncation parse error
            // that had nothing to do with the actual hang under
            // investigation, just an under-provisioned check.
            model: modelId,
            max_tokens: 2000,
            system: realSystemPrompt,
            output_config: { format: zodOutputFormat(turnOutputSchema) },
            messages: [{ role: "user", content: "Reply with a minimal valid turn: any message, any weaknessCritique, confidence 0.5, readyToDecide false." }],
          },
          { timeout: CHECK_TIMEOUT_MS, signal },
        )
        .then(() => "ok"),
    ),
  ]);

  // One batched write, not 11 sequential ones -- with the two extended
  // checks now taking up to 45s of the route's 60s budget, a sequential
  // logging tail left too little margin for any DB latency spike (a real
  // /code-review finding on this diff). A first fix (Promise.all) traded
  // that risk for a different one caught by a second review pass: fully
  // concurrent writes can commit out of order, and this page displays
  // newest-first by createdAt, so the battery's reasoning-order narrative
  // could render scrambled. logDiagnosticBatch gets both: one fast
  // round-trip, explicit incrementing timestamps to guarantee display
  // order matches the array.
  await logDiagnosticBatch(
    results.map((r) => ({
      source: "diagnose:battery",
      level: r.ok ? ("info" as const) : ("error" as const),
      message: r.ok
        ? `${r.label}: succeeded in ${r.elapsedMs}ms (${r.detail})`
        : `${r.label}: failed after ${r.elapsedMs}ms: ${r.detail}`,
      detail: { promptLength: r.promptLength },
    })),
  );
}
