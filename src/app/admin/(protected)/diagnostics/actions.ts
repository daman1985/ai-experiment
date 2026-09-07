"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logDiagnostic } from "@/lib/diagnostics";
import { buildSystemPrompt, buildResearchPrompt, buildTurnPrompt } from "@/lib/agents/prompt";
import { turnOutputSchema } from "@/lib/agents/schema";

// Every isolated check run so far via /api/diagnose-anthropic used
// placeholder content (a one-line system prompt, "Say OK") and succeeded
// in 1-3 seconds -- but the app's real turn/research calls, using the
// app's actual generated system/research/turn prompts, keep timing out
// at exactly their configured ceiling regardless of transcript size
// (confirmed: a 123-char and a 23,592-char turnText both hang for
// exactly their full timeout). The one thing not yet isolated is the
// *real* prompt content itself. This runs the exact same
// buildSystemPrompt/buildResearchPrompt/buildTurnPrompt output a real
// turn would send -- for an empty, single-agent-room scenario, since
// content size has already been ruled out as the variable -- against
// the real configured key and model, and logs the result to
// DiagnosticEvent so it shows up on this same page without needing curl
// or a separate secret-gated route.
const CHECK_TIMEOUT_MS = 20_000;

async function timedCall<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<{ ok: true; elapsedMs: number; value: T } | { ok: false; elapsedMs: number; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const start = Date.now();
  try {
    const value = await fn(controller.signal);
    return { ok: true, elapsedMs: Date.now() - start, value };
  } catch (err) {
    return {
      ok: false,
      elapsedMs: Date.now() - start,
      error: controller.signal.aborted
        ? `timed out after ${ms}ms`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runRealPromptCheckAction(): Promise<void> {
  const config = await prisma.providerConfig.findUnique({ where: { provider: "ANTHROPIC" } });
  if (!config) {
    await logDiagnostic({
      source: "diagnose:real-prompt",
      level: "error",
      message: "no Anthropic provider config found",
    });
    revalidatePath("/admin/diagnostics");
    return;
  }

  const apiKey = decrypt({ encrypted: config.encryptedApiKey, iv: config.iv, authTag: config.authTag });
  const client = new Anthropic({ apiKey, maxRetries: 1 });

  // Same builders, same shape of inputs a real empty/fresh run's first
  // turn would produce -- an empty transcript, no prior decisions, not a
  // forced vote.
  const systemPrompt = buildSystemPrompt({
    selfRoomLabel: "Agent A",
    otherRoomLabels: ["Agent B", "Agent C"],
    topic: "Decide what business to start, then who does what, then run it.",
    isForcedVote: false,
    forcedVoteRoundCap: 6,
    priorDecisions: [],
  });
  const researchPrompt = buildResearchPrompt([], "Agent A");
  const turnPrompt = buildTurnPrompt({
    transcript: [],
    selfRoomLabel: "Agent A",
    researchNote: null,
    documents: [],
  });

  const [research, turn, bareWithRealSystem] = await Promise.all([
    timedCall(
      (signal) =>
        client.messages.create(
          {
            model: config.defaultModelId,
            max_tokens: 2000,
            system: systemPrompt,
            tools: [
              { type: "web_search_20260318", name: "web_search", max_uses: 1, allowed_callers: ["direct"] },
            ],
            messages: [{ role: "user", content: researchPrompt }],
          },
          { timeout: CHECK_TIMEOUT_MS, signal },
        ),
      CHECK_TIMEOUT_MS,
    ),
    timedCall(
      (signal) =>
        client.messages.parse(
          {
            model: config.defaultModelId,
            max_tokens: 2000,
            system: systemPrompt,
            output_config: { format: zodOutputFormat(turnOutputSchema) },
            messages: [{ role: "user", content: turnPrompt }],
          },
          { timeout: CHECK_TIMEOUT_MS, signal },
        ),
      CHECK_TIMEOUT_MS,
    ),
    // The decisive bisection: the real system prompt, but no tools and
    // no structured-output schema -- a completely bare completion. If
    // this ALSO hangs, the system prompt content alone is sufficient to
    // trigger it, independent of tool-use or structured output. If it
    // succeeds, the hang requires the real system prompt *combined with*
    // one of those two features.
    timedCall(
      (signal) =>
        client.messages.create(
          {
            model: config.defaultModelId,
            max_tokens: 50,
            system: systemPrompt,
            messages: [{ role: "user", content: "Reply with just the word OK." }],
          },
          { timeout: CHECK_TIMEOUT_MS, signal },
        ),
      CHECK_TIMEOUT_MS,
    ),
  ]);

  await logDiagnostic({
    source: "diagnose:real-prompt",
    level: research.ok ? "info" : "error",
    message: research.ok
      ? `real research prompt succeeded in ${research.elapsedMs}ms`
      : `real research prompt failed after ${research.elapsedMs}ms: ${research.error}`,
    detail: { systemPromptLength: systemPrompt.length, researchPromptLength: researchPrompt.length },
  });
  await logDiagnostic({
    source: "diagnose:real-prompt",
    level: turn.ok ? "info" : "error",
    message: turn.ok
      ? `real turn prompt succeeded in ${turn.elapsedMs}ms`
      : `real turn prompt failed after ${turn.elapsedMs}ms: ${turn.error}`,
    detail: { systemPromptLength: systemPrompt.length, turnPromptLength: turnPrompt.length },
  });
  await logDiagnostic({
    source: "diagnose:real-prompt",
    level: bareWithRealSystem.ok ? "info" : "error",
    message: bareWithRealSystem.ok
      ? `real system prompt, no tools/schema, succeeded in ${bareWithRealSystem.elapsedMs}ms`
      : `real system prompt, no tools/schema, failed after ${bareWithRealSystem.elapsedMs}ms: ${bareWithRealSystem.error}`,
    detail: { systemPromptLength: systemPrompt.length },
  });

  revalidatePath("/admin/diagnostics");
}
