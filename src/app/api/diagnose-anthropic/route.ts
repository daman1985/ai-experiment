import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { turnOutputSchema } from "@/lib/agents/schema";

// TEMPORARY diagnostic route -- not part of the app's normal operation,
// safe to delete once the "every Anthropic call times out" investigation
// is resolved. First pass (a bare messages.create, no tools, no schema,
// 10 max_tokens) confirmed from the exact production runtime that the
// key, model id, and network egress to Anthropic are all fine -- it
// returned in 1.36s. So the hang is specific to something about the
// *real* request shape the provider adapter actually sends, which this
// bare call didn't exercise. The two things the real research and turn
// calls add on top of a bare call are (a) the web_search tool and (b)
// structured-output schema formatting (output_config/zodOutputFormat via
// messages.parse) -- this runs both in isolation, alongside the
// already-confirmed bare call, to find out which one (or both) is
// actually responsible, rather than guessing further.
//
// Gated with the same CRON_SECRET bearer token the tick route already
// uses, rather than inventing a new secret.
export const maxDuration = 45;
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 20_000;

interface CheckResult {
  outcome: "success" | "silent_hang" | "distinct_error";
  elapsedMs: number;
  detail?: string;
  errorName?: string;
  errorMessage?: string;
}

async function runCheck(fn: (signal: AbortSignal) => Promise<string>): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  const start = Date.now();
  try {
    const detail = await fn(controller.signal);
    return { outcome: "success", elapsedMs: Date.now() - start, detail };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const wasOurTimeout = controller.signal.aborted;
    return {
      outcome: wasOurTimeout ? "silent_hang" : "distinct_error",
      elapsedMs,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured on the server." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.providerConfig.findUnique({ where: { provider: "ANTHROPIC" } });
  if (!config) {
    return NextResponse.json({ error: "No Anthropic provider config found." }, { status: 400 });
  }

  const apiKey = decrypt({ encrypted: config.encryptedApiKey, iv: config.iv, authTag: config.authTag });
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  const modelId = config.defaultModelId;

  const [bare, structuredOutput, webSearchTool] = await Promise.all([
    runCheck(async (signal) => {
      const r = await client.messages.create(
        { model: modelId, max_tokens: 10, messages: [{ role: "user", content: "Say OK." }] },
        { timeout: CHECK_TIMEOUT_MS, signal },
      );
      return r.content.find((b) => b.type === "text")?.text ?? "(no text)";
    }),
    runCheck(async (signal) => {
      const r = await client.messages.parse(
        {
          model: modelId,
          max_tokens: 500,
          system: "You are a test.",
          output_config: { format: zodOutputFormat(turnOutputSchema) },
          messages: [{ role: "user", content: "Say something trivial and set readyToDecide to false." }],
        },
        { timeout: CHECK_TIMEOUT_MS, signal },
      );
      return r.parsed_output ? "parsed ok" : "parse failed";
    }),
    runCheck(async (signal) => {
      const r = await client.messages.create(
        {
          model: modelId,
          max_tokens: 200,
          system: "You are a test.",
          tools: [{ type: "web_search_20260318", name: "web_search", max_uses: 1, allowed_callers: ["direct"] }],
          messages: [{ role: "user", content: "What is 2+2? Do not search, just answer." }],
        },
        { timeout: CHECK_TIMEOUT_MS, signal },
      );
      return r.content.find((b) => b.type === "text")?.text ?? "(no text)";
    }),
  ]);

  return NextResponse.json({ modelId, bare, structuredOutput, webSearchTool });
}
