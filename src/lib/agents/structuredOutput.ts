import type { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { withTimeout } from "./withTimeout";
import { logDiagnostic } from "@/lib/diagnostics";

// Shared by every call site that asks an Anthropic model for structured
// JSON via client.messages.create() (never .parse() -- see the comment on
// its one caller in providers/anthropic.ts for why: .parse() throws away
// the response, including stop_reason, on any parse/validation failure,
// which is exactly the diagnostic information a real production failure
// needs). Only the first "text" content block is used, matching the SDK's
// own parseMessage(): every other adapter that ever emits multiple text
// blocks (e.g. future extended-thinking output) would otherwise get its
// blocks silently concatenated into one JSON.parse call, corrupting an
// otherwise-valid response.
export function firstTextBlock(content: { type: string; text?: string }[]): string {
  const block = content.find((b): b is { type: string; text: string } => b.type === "text");
  return block?.text ?? "";
}

export type StructuredParseResult<T> = { success: true; data: T } | { success: false; reason: string };

// A thrown ZodError's own .message is an unbounded, multi-line
// pretty-printed issue dump -- fine for a stack trace, not for a
// diagnostic log line meant to be one row of a copy-pasteable operational
// log (see src/app/admin/(protected)/diagnostics/page.tsx). Bounded to 5
// issues on one line, matching zodOutputFormat's own .parse() helper.
export function parseStructuredOutput<T>(rawText: string, schema: z.ZodType<T>): StructuredParseResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return { success: false, reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const validation = schema.safeParse(parsed);
  if (validation.success) {
    return { success: true, data: validation.data };
  }
  const issues = validation.error.issues;
  const reason =
    issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ") + (issues.length > 5 ? `; +${issues.length - 5} more` : "");
  return { success: false, reason };
}

export interface StructuredOutputCallOptions<T> {
  client: Anthropic;
  params: Anthropic.MessageCreateParamsNonStreaming;
  schema: z.ZodType<T>;
  timeoutMs: number;
  // Passed to withTimeout()'s own timeout-error message, e.g. "Anthropic
  // turn call".
  label: string;
  // logDiagnostic's `source` -- e.g. "anthropic:turn" or
  // "decisionExtraction:consensus".
  source: string;
  runId?: string;
  // Extra fields merged into the outer (API-call) failure log's detail
  // only -- e.g. the turn call's systemPromptLength/turnTextLength, which
  // help distinguish a too-long-prompt failure from anything else. Not
  // used for the parse-failure branch, which always logs
  // stopReason/outputTokens/rawTextLength/textPreview.
  extraFailureDetail?: Record<string, unknown>;
}

// The full call -> parse -> diagnose sequence shared by every structured-
// output call site in this codebase (the turn call, all three decision-
// extraction calls, and the expert audit). Pulled out once three near-
// identical copies of this had already started drifting (one had extra
// failure detail the others didn't) -- see providers/anthropic.ts's
// comment on why client.messages.create() (not .parse()) is used, and why
// only the first text block is parsed.
export async function callStructuredOutput<T>(
  options: StructuredOutputCallOptions<T>,
): Promise<{ data: T; inputTokens: number; outputTokens: number }> {
  const { client, params, schema, timeoutMs, label, source, runId, extraFailureDetail } = options;
  const callStart = Date.now();
  let response: Anthropic.Message;
  try {
    response = await withTimeout(
      (signal) => client.messages.create(params, { timeout: timeoutMs, signal }),
      timeoutMs,
      label,
    );
  } catch (err) {
    await logDiagnostic({
      source,
      level: "error",
      runId,
      message: `failed after ${Date.now() - callStart}ms: ${err instanceof Error ? err.message : String(err)}`,
      detail: extraFailureDetail,
    });
    throw err;
  }

  const rawText = firstTextBlock(response.content);
  const parseResult = parseStructuredOutput(rawText, schema);
  if (!parseResult.success) {
    // stop_reason distinguishes "cut off before finishing the JSON"
    // (max_tokens) from a genuine refusal or malformed output.
    await logDiagnostic({
      source,
      level: "error",
      runId,
      message: `succeeded in ${Date.now() - callStart}ms but failed to parse into the required schema (stop_reason: ${response.stop_reason}): ${parseResult.reason}`,
      detail: {
        stopReason: response.stop_reason,
        outputTokens: response.usage.output_tokens,
        rawTextLength: rawText.length,
        textPreview: rawText.slice(0, 500),
      },
    });
    throw new Error(`${label} failed to parse into the required schema (stop_reason: ${response.stop_reason}).`);
  }

  return {
    data: parseResult.data,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
