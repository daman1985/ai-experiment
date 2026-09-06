import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { formatTranscript } from "./prompt";
import type { TranscriptEntryForPrompt } from "./schema";

// This is a mechanical extraction step, not a decision-making one: it reads
// turns the three agents already produced and reports what they said,
// rather than deciding anything itself. Kept intentionally separate from
// the participant model choices (always the cheap, fast Claude tier) since
// its job is narrow and doesn't need to match whatever models the agents
// are using this run.
const EXTRACTION_MODEL_ID = "claude-haiku-4-5";

const consensusExtractionSchema = z.object({
  outcome: z
    .string()
    .describe("A clear, one-to-two sentence statement of what the group agreed on, based only on what they actually said."),
});

const roleAssignmentExtractionSchema = z.object({
  outcome: z.string().describe("A one-sentence summary of the agreed role structure."),
  roles: z
    .array(z.object({ agentDisplayName: z.string(), role: z.string() }))
    .describe("The specific role assigned to each participant."),
});

const voteTallyExtractionSchema = z.object({
  outcome: z.string().describe("The winning position, stated plainly."),
  dissent: z
    .array(z.object({ agentDisplayName: z.string(), reason: z.string() }))
    .describe("Any agent(s) whose vote did not match the winning position, and why they voted differently. Empty array if unanimous."),
});

async function callExtraction<T>(
  apiKey: string,
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<{ result: T; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model: EXTRACTION_MODEL_ID,
    max_tokens: 1000,
    system,
    output_config: { format: zodOutputFormat(schema) },
    messages: [{ role: "user", content: prompt }],
  });
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

export async function extractRoleAssignment(
  apiKey: string,
  transcript: TranscriptEntryForPrompt[],
) {
  return callExtraction(
    apiKey,
    "You extract role assignments a group of AI agents agreed on from their conversation. Report only what was actually said -- never add, infer, or improve on their decision.",
    `Conversation:\n\n${formatTranscript(transcript)}\n\n---\n\nAll participants signaled they're ready to decide. State the exact role each participant was assigned.`,
    roleAssignmentExtractionSchema,
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
