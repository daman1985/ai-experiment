import { z } from "zod";

// Structured output every agent must produce each turn, across all three
// providers. weaknessCritique is mandatory (not optional) by design: it's
// the structural counter to multi-agent sycophancy/convergence -- an agent
// has to name a real weakness in the current leading proposal before it's
// allowed to signal agreement via readyToDecide. yieldToDisplayName and
// voteChoice are validated against the run's actual agents/phase state
// after parsing, not by the schema itself, since valid values depend on
// runtime context (which agents exist, whether this is a forced-vote turn).
export const turnOutputSchema = z.object({
  message: z.string().describe("What you say to the room this turn."),
  weaknessCritique: z
    .string()
    .describe(
      "The single biggest weakness in the current leading proposal or plan, stated plainly. Required even when you ultimately agree with the proposal.",
    ),
  confidenceBeforePeerUpdate: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Your genuine confidence in the current leading position based only on your own reasoning, before weighing anything peers said this round. 0.0-1.0.",
    ),
  confidenceAfterPeerUpdate: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Your genuine confidence in the current leading position after this turn's reasoning, having now weighed peers' contributions. 0.0-1.0. A large jump toward the group's apparent consensus is worth being honest about, not smoothing over.",
    ),
  readyToDecide: z
    .boolean()
    .describe("True only if you believe the group has enough to decide now."),
  yieldToRoomLabel: z
    .string()
    .nullable()
    .describe(
      "Room label (e.g. 'Agent B') of another participant to address directly / hear from next, or null if you're not yielding to anyone specific.",
    ),
  voteChoice: z
    .string()
    .nullable()
    .describe(
      "Your final vote, only when this is an explicit forced-vote round; otherwise null.",
    ),
  artifact: z
    .object({
      type: z
        .string()
        .describe("Short category label, e.g. 'landing_page_copy', 'business_plan', 'marketing_draft'."),
      title: z.string(),
      content: z.string(),
    })
    .nullable()
    .describe(
      "An optional piece of collateral to publish this turn (a document, draft, or plan). Null if this turn doesn't produce one. Remember: this is simulated output, never sent anywhere real.",
    ),
});

export type TurnOutput = z.infer<typeof turnOutputSchema>;

export interface ToolCallLogEntry {
  query: string;
  resultSummary: string;
}

export interface TranscriptEntryForPrompt {
  speakerRoomLabel: string;
  message: string;
  weaknessCritique: string;
  readyToDecide: boolean;
  yieldToRoomLabel: string | null;
  isVote: boolean;
  voteChoice: string | null;
}

export interface RunTurnInput {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  transcript: TranscriptEntryForPrompt[];
  selfRoomLabel: string;
  otherRoomLabels: string[];
  enableResearch: boolean;
  isForcedVote: boolean;
}

export interface RunTurnResult {
  output: TurnOutput;
  inputTokens: number;
  outputTokens: number;
  toolCalls: ToolCallLogEntry[];
}

export interface ProviderAdapter {
  runTurn(input: RunTurnInput): Promise<RunTurnResult>;
}
