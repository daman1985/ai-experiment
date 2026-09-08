import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { formatTranscript } from "./prompt";
import type { TranscriptEntryForPrompt } from "./schema";
import { callStructuredOutput } from "./structuredOutput";

// This is a mechanical extraction step, not a decision-making one: it reads
// turns the three agents already produced and reports what they said,
// rather than deciding anything itself. Kept intentionally separate from
// the participant model choices (always the cheap, fast Claude tier) since
// its job is narrow and doesn't need to match whatever models the agents
// are using this run.
const EXTRACTION_MODEL_ID = "claude-haiku-4-5";

// Same reasoning as the provider adapters: the Anthropic SDK defaults to
// a 10-minute request timeout with automatic retries. The SDK-level
// `timeout` option below is kept, but withTimeout() (a plain Promise.race)
// is the actual guarantee. Confirmed directly against production that a
// real research/turn call reading real conversational content can
// legitimately take far longer than a trivial-content test suggested (up
// to ~35s) -- this runs on the faster/cheaper Haiku tier and a narrower,
// more mechanical task (report what was said, don't originate content),
// so it's less likely to need as much margin, but it also reads the full
// real transcript, not placeholder content, so it gets a real bump too
// rather than assuming the old 15s was ever actually validated against
// genuine transcript sizes.
const EXTRACTION_TIMEOUT_MS = 25_000;

const consensusExtractionSchema = z.object({
  outcome: z
    .string()
    .describe("A clear, one-to-two sentence statement of what the group agreed on, based only on what they actually said."),
});

const voteTallyExtractionSchema = z.object({
  outcome: z.string().describe("The winning position, stated plainly."),
  dissent: z
    .array(z.object({ agentDisplayName: z.string(), reason: z.string() }))
    .describe("Any agent(s) whose vote did not match the winning position, and why they voted differently. Empty array if unanimous."),
});

const rootCauseCheckSchema = z.object({
  untestedAssumption: z
    .string()
    .describe(
      "The single most significant assumption this decision rests on that nobody in the conversation actually tested or verified -- not a restatement of a weakness someone already raised and addressed.",
    ),
  likelyFailureMode: z
    .string()
    .describe("If that assumption turns out to be wrong, the most likely concrete way this decision fails in practice."),
});

// See structuredOutput.ts's callStructuredOutput for why this goes
// through client.messages.create() plus manual parsing rather than
// .parse() (which throws away stop_reason/usage/raw text on any
// parse/validation failure). This call sits directly on the
// consensus/vote-resolution path with no caller-side try/catch at all
// (see checkConsensus/handleForcedVoteTurn in engine.ts), so a failure
// here used to propagate as a bare, undiagnosable AnthropicError.
async function callExtraction<T>(
  apiKey: string,
  runId: string,
  source: string,
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<{ result: T; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const { data, inputTokens, outputTokens } = await callStructuredOutput({
    client,
    params: {
      model: EXTRACTION_MODEL_ID,
      max_tokens: 1000,
      system,
      output_config: { format: zodOutputFormat(schema) },
      messages: [{ role: "user", content: prompt }],
    },
    schema,
    timeoutMs: EXTRACTION_TIMEOUT_MS,
    label: "Decision extraction call",
    source,
    runId,
  });
  return { result: data, inputTokens, outputTokens };
}

export async function extractConsensusOutcome(
  apiKey: string,
  runId: string,
  transcript: TranscriptEntryForPrompt[],
) {
  return callExtraction(
    apiKey,
    runId,
    "decisionExtraction:consensus",
    "You extract what a group of AI agents agreed on from their conversation. Report only what was actually said -- never add, infer, or improve on their decision.",
    `Conversation:\n\n${formatTranscript(transcript)}\n\n---\n\nAll participants signaled they're ready to decide. State what they agreed on.`,
    consensusExtractionSchema,
  );
}

export async function extractVoteTally(
  apiKey: string,
  runId: string,
  votes: { agentDisplayName: string; voteChoice: string }[],
) {
  const voteText = votes.map((v) => `${v.agentDisplayName}: ${v.voteChoice}`).join("\n");
  return callExtraction(
    apiKey,
    runId,
    "decisionExtraction:voteTally",
    "You tally votes cast by a group of AI agents. Determine the majority (or plurality) position and identify any dissent. Do not judge which position is better -- only report the count.",
    `Votes cast:\n\n${voteText}\n\n---\n\nWhich position won, and who (if anyone) dissented?`,
    voteTallyExtractionSchema,
  );
}

// A structural analog to an "enhancing cognition"-style re-evaluation
// gate, run once over the finished decision rather than folded into the
// per-turn schema -- see the comment on Decision.untestedAssumption in
// schema.prisma for why. This is a skeptical outside read, not a
// continuation of the debate: it never argues for a different outcome,
// only names what the group didn't actually examine.
export async function extractRootCauseCheck(
  apiKey: string,
  runId: string,
  transcript: TranscriptEntryForPrompt[],
  outcome: string,
) {
  return callExtraction(
    apiKey,
    runId,
    "decisionExtraction:rootCause",
    "You are a skeptical outside reviewer reading a decision a group of AI agents just reached. You do not participate in or relitigate the decision -- you identify what the group didn't actually examine, based only on what they said.",
    `Conversation:\n\n${formatTranscript(transcript)}\n\n---\n\nThe group decided: ${outcome}\n\nWhat is the single most significant assumption this decision rests on that nobody actually tested or verified in the conversation above? If that assumption is wrong, what's the most likely concrete way this decision fails in practice?`,
    rootCauseCheckSchema,
  );
}
