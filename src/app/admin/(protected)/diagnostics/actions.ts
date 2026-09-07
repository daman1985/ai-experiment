"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logDiagnostic } from "@/lib/diagnostics";
import { buildSystemPrompt, buildResearchPrompt, buildTurnPrompt } from "@/lib/agents/prompt";
import { turnOutputSchema } from "@/lib/agents/schema";

// Wipes every recorded event so the next action's output is unambiguous
// -- otherwise fresh results sit above a growing pile of old ones and
// it's easy to mistake a stale error for a new one at a glance. Logs its
// own count/timestamp *after* clearing (the one deliberate exception to
// "this button empties the log") so a click that doesn't visibly do
// anything is instantly diagnosable: if this line doesn't appear, the
// click never reached the server at all (stale page, browser cache) --
// no need to guess.
export async function clearDiagnosticsAction(): Promise<void> {
  const { count } = await prisma.diagnosticEvent.deleteMany({});
  await logDiagnostic({
    source: "diagnose:clear",
    level: "info",
    message: `cleared ${count} event(s)`,
  });
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

interface CheckOutcome {
  label: string;
  ok: boolean;
  elapsedMs: number;
  detail: string;
  promptLength: number;
}

async function timedCall(
  label: string,
  promptLength: number,
  fn: (signal: AbortSignal) => Promise<string>,
): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  const start = Date.now();
  try {
    const value = await fn(controller.signal);
    return { label, ok: true, elapsedMs: Date.now() - start, detail: value, promptLength };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    return {
      label,
      ok: false,
      elapsedMs,
      detail: controller.signal.aborted
        ? `timed out after ${CHECK_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err),
      promptLength,
    };
  } finally {
    clearTimeout(timer);
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
  const config = await prisma.providerConfig.findUnique({ where: { provider: "ANTHROPIC" } });
  if (!config) {
    await logDiagnostic({
      source: "diagnose:battery",
      level: "error",
      message: "no Anthropic provider config found",
    });
    revalidatePath("/admin/diagnostics");
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
    timedCall("real_tools (full research call)", realSystemPrompt.length, (signal) =>
      client.messages
        .create(
          { model: modelId, max_tokens: 2000, system: realSystemPrompt, tools: webSearchTools, messages: [{ role: "user", content: researchPrompt }] },
          { timeout: CHECK_TIMEOUT_MS, signal },
        )
        .then(() => "ok"),
    ),
    timedCall("real_schema (full turn call)", realSystemPrompt.length, (signal) =>
      client.messages
        .parse(
          { model: modelId, max_tokens: 2000, system: realSystemPrompt, output_config: { format: zodOutputFormat(turnOutputSchema) }, messages: [{ role: "user", content: turnPrompt }] },
          { timeout: CHECK_TIMEOUT_MS, signal },
        )
        .then(() => "ok"),
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
            model: modelId,
            max_tokens: 50,
            system: realSystemPrompt,
            output_config: { format: zodOutputFormat(turnOutputSchema) },
            messages: [{ role: "user", content: "Reply with a minimal valid turn: any message, any weaknessCritique, confidence 0.5, readyToDecide false." }],
          },
          { timeout: CHECK_TIMEOUT_MS, signal },
        )
        .then(() => "ok"),
    ),
  ]);

  for (const r of results) {
    await logDiagnostic({
      source: "diagnose:battery",
      level: r.ok ? "info" : "error",
      message: r.ok
        ? `${r.label}: succeeded in ${r.elapsedMs}ms (${r.detail})`
        : `${r.label}: failed after ${r.elapsedMs}ms: ${r.detail}`,
      detail: { promptLength: r.promptLength },
    });
  }

  revalidatePath("/admin/diagnostics");
}
