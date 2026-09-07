import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import Anthropic from "@anthropic-ai/sdk";

// TEMPORARY diagnostic route -- not part of the app's normal operation,
// safe to delete once the "every Anthropic call times out" investigation
// is resolved. Confirmed from real production ticks: every Anthropic
// call across every run has hit its full 15s/20s timeout with a 100%
// failure rate, and the only error ever logged is this app's own
// withTimeout message -- never a distinct network-level error from the
// SDK itself. That pattern (silence until *our* timer fires, never
// Anthropic's own fast rejection) is consistent with the request never
// getting a response at all, but it needs isolating from this exact
// runtime (Vercel's own egress to Anthropic), not from anywhere else --
// testing the key from a different network path (a developer's laptop,
// this session's own sandboxed environment) wouldn't tell us anything
// about whether *this* deployment's outbound path is the problem.
//
// This makes the smallest possible real call -- no tools, no schema, 10
// max_tokens -- reusing the exact key/decrypt path the real adapters use,
// and reports back enough detail to actually distinguish causes: how
// long it took, and if it failed, whether that was our own timeout
// firing (silence) or a distinct error Anthropic's own servers returned
// (auth, rate limit, bad model id, etc.) fast enough to matter.
//
// Gated with the same CRON_SECRET bearer token the tick route already
// uses, rather than inventing a new secret -- this never needs the
// user's actual Anthropic key exposed to whoever calls it, only the
// app's own already-provisioned bearer secret.
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const DIAGNOSTIC_TIMEOUT_MS = 20_000;

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await client.messages.create(
      {
        model: config.defaultModelId,
        max_tokens: 10,
        messages: [{ role: "user", content: "Say OK." }],
      },
      { timeout: DIAGNOSTIC_TIMEOUT_MS, signal: controller.signal },
    );
    clearTimeout(timer);
    return NextResponse.json({
      outcome: "success",
      elapsedMs: Date.now() - start,
      modelId: config.defaultModelId,
      responseText: response.content.find((b) => b.type === "text")?.text ?? null,
    });
  } catch (err) {
    clearTimeout(timer);
    const elapsedMs = Date.now() - start;
    const wasOurTimeout = controller.signal.aborted;
    return NextResponse.json({
      outcome: wasOurTimeout ? "silent_hang" : "distinct_error",
      elapsedMs,
      modelId: config.defaultModelId,
      // wasOurTimeout=true: Anthropic's servers never responded at all
      // within the timeout -- points at a network/egress problem, not
      // an application-level rejection.
      // wasOurTimeout=false: Anthropic's own servers actively rejected
      // the request (fast enough that our timer never fired) -- points
      // at auth, rate limiting, or a bad model id instead.
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCause:
        err instanceof Error && err.cause instanceof Error
          ? { name: err.cause.name, message: err.cause.message }
          : undefined,
    });
  }
}
