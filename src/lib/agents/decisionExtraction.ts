import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { formatTranscript } from "./prompt";
import type { TranscriptEntryForPrompt } from "./schema";
import { withTimeout } from "./withTimeout";

// This is a mechanical extraction step, not a decision-making one: it reads
// turns the three agents already produced and reports what they said,
// rather than deciding anything itself. Kept intentionally separate from
// the participant model choices (always the cheap, fast Claude tier) since
// its job is narrow and doesn't need to match whatever models the agents
// are using this run.
const EXTRACTION_MODEL_ID = "claude-haiku-4-5";

// Same reasoning as the provider adapters: the Anthropic SDK defaults to
// a 10-minute request timeout with automatic retries, which is far
// longer than the cron route's 60s budget can tolerate for a call that
// runs inline during a tick (checkConsensus / handleForcedVoteTurn). The
// SDK-level `timeout` option below is kept, but a production hang proved
// it isn't reliably enforced on its own -- withTimeout() wraps the call
// in a plain Promise.race so the calling code can't get stuck behind it.
const EXTRACTION_TIMEOUT_MS = 15_000;

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

async function callExtraction<T>(
  apiKey: string,
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<{ result: T; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const response = await withTimeout(
    client.messages.parse(
      {
        model: EXTRACTION_MODEL_ID,
        max_tokens: 1000,
        system,
        output_config: { format: zodOutputFormat(schema) },
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: EXTRACTION_TIMEOUT_MS },
    ),
    EXTRACTION_TIMEOUT_MS,
    "Decision extraction call",
  );
  if (!response.parsed_output) {
    throw new Error("Decision extraction call failed to parse.");
  }
  return {
    result: response.parsed_output,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function extractConsensusOutcome(
  apiKey: string,
  transcript: TranscriptEntryForPrompt[],
) {
  return callExtraction(
    apiKey,
    "You extract what a group of AI agents agreed on from their conversation. Report only what was actually said -- never add, infer, or improve on their decision.",
    `Conversation:\n\n${formatTranscript(transcript)}\n\n---\n\nAll participants signaled they're ready to decide. State what they agreed on.`,
    consensusExtractionSchema,
  );
}

export async function extractVoteTally(
  apiKey: string,
  votes: { agentDisplayName: string; voteChoice: string }[],
) {
  const voteText = votes.map((v) => `${v.agentDisplayName}: ${v.voteChoice}`).join("\n");
  return callExtraction(
    apiKey,
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
  transcript: TranscriptEntryForPrompt[],
  outcome: string,
) {
  return callExtraction(
    apiKey,
    "You are a skeptical outside reviewer reading a decision a group of AI agents just reached. You do not participate in or relitigate the decision -- you identify what the group didn't actually examine, based only on what they said.",
    `Conversation:\n\n${formatTranscript(transcript)}\n\n---\n\nThe group decided: ${outcome}\n\nWhat is the single most significant assumption this decision rests on that nobody actually tested or verified in the conversation above? If that assumption is wrong, what's the most likely concrete way this decision fails in practice?`,
    rootCauseCheckSchema,
  );
}
