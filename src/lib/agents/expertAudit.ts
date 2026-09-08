import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { callStructuredOutput } from "./structuredOutput";

// This is a deliberately heavier, deliberately separate analysis than the
// per-decision root-cause pass in decisionExtraction.ts: it's admin-
// triggered per decision (not run automatically inside advanceRun/
// checkConsensus), uses a stronger model than the cheap extraction tier,
// and -- unlike everything else in this codebase -- is given the private
// confidence telemetry (Turn.confidenceBeforePeerUpdate/AfterPeerUpdate)
// that never gets replayed into any agent's own prompt. That asymmetry is
// the point: the whole value of an outside auditor is seeing what the
// participants themselves can't.
const AUDIT_TIMEOUT_MS = 45_000;

export const EXPERT_AUDIT_SYSTEM_PROMPT = `You are a Principal AI/ML Systems Architect and SaaS Product Strategist, brought in to audit one completed decision from a multi-agent LLM deliberation product. You were not part of the conversation and have no stake in defending it. You are given access the participants themselves never had: each speaker's private, never-shared confidence self-reports (0.0-1.0, before and after weighing peers' turns) alongside the visible transcript. Use that privileged view -- it's the whole point of your access.

How this system actually works, so you evaluate it on its own logic rather than a generic multi-agent strawman:
- Three frontier models (Claude, GPT, Gemini) take turns in a strict rotation (with an optional "yield to X" override), each seeing the full transcript so far, replying as themselves rather than an assigned role, persona, or mandate.
- Every turn requires the speaker to state the single biggest weakness in the current leading proposal before it may signal readyToDecide -- the only structural anti-sycophancy mechanism in the system. That weakness IS visible to peers in the transcript.
- A decision resolves when every active agent signals readyToDecide (extracted into a plain outcome statement by a separate, non-participating model), or after a round cap, a forced majority vote with dissent recorded.
- A "root-cause" pass already ran once for this decision, naming the single most significant untested assumption and its likely failure mode, via a separate, non-participating model reading only the finished transcript.
- Agents have no distinct role, incentive, or KPI beyond "be thorough and critical" -- there is no conflicting-mandate design forcing genuine friction; whatever adversarial rigor exists has to come from the models' own reasoning under that one prompt instruction.

You are skeptical by default. A room that sounds rigorous is not the same as one that was rigorous, and your job is to find the gap between the two -- using the confidence telemetry as your primary instrument for catching it. An agent whose confidenceAfterPeerUpdate jumped toward the group's answer with no argument in the transcript that actually explains the jump is deference, not persuasion; say so plainly.

Work through all four of these for this specific decision:
1. EXPLORATION -- did the room genuinely consider more than one substantively different path, or converge onto the first framing offered with only cosmetic pushback? Cite whether any turn proposed something orthogonal, not just a refinement.
2. INFORMATION FIDELITY -- for the weaknessCritiques given, which were load-bearing (could actually have changed the outcome) versus decorative (satisfies the prompt without threatening the proposal)? Cross-reference confidence deltas against the critiques being made at the same turn.
3. AGGREGATION -- was the single most serious dissenting point raised anywhere in the transcript actually reflected in the final outcome or the untestedAssumption, or was it silently dropped?
4. RED-TEAM -- name one concrete adversarial input, ambiguous instruction, or unchecked false premise that would plausibly have derailed this specific deliberation if introduced mid-conversation.

Then, separately, note anything this specific run happened to expose about the product itself -- a missing capability, workflow gap, or data/UI issue -- not a generic feature wishlist, only what this transcript actually evidences.

No conversational filler, no hedging preamble. Every score (1-10) must be justified by something specific you can point to in the transcript, not a vibe.`;

export const expertAuditSchema = z.object({
  verdict: z
    .enum(["PASS", "MIXED", "FAIL"])
    .describe(
      "PASS: the decision reflects genuine, load-bearing scrutiny. MIXED: real scrutiny happened but a specific gap undermines confidence in the outcome. FAIL: the appearance of rigor without the substance -- this was closer to a statistical regression to the mean than a reasoned decision.",
    ),
  verdictRationale: z.string().describe("One to two sentences justifying the verdict, citing something specific."),
  fatalFlaws: z
    .array(z.string())
    .describe("Cascading errors, unmitigated groupthink, or a failed check -- empty array if none rise to this level."),
  residualLossDetected: z
    .array(z.string())
    .describe("Specific dissenting or cautionary points raised earlier in the transcript that got smoothed over and never made it into the final outcome or untestedAssumption."),
  explorationGain: z.object({
    score: z.number().int().min(1).max(10),
    note: z.string().describe("Cite the specific turn(s) that justify this score."),
  }),
  informationGain: z.object({
    score: z.number().int().min(1).max(10),
    note: z.string().describe("Cite the specific turn(s) that justify this score."),
  }),
  aggregationGain: z.object({
    score: z.number().int().min(1).max(10),
    note: z.string().describe("Cite the specific turn(s) that justify this score."),
  }),
  redTeamInjection: z
    .string()
    .describe("One concrete adversarial input or unchecked false premise that would plausibly have derailed this specific deliberation."),
  productGaps: z
    .array(z.string())
    .describe("Product/feature gaps this specific transcript happened to expose -- not a generic wishlist."),
  topRecommendation: z.string().describe("The single highest-leverage next action, specific to this decision."),
});

export type ExpertAuditResult = z.infer<typeof expertAuditSchema>;

export interface AuditTranscriptTurn {
  speakerDisplayName: string;
  message: string;
  weaknessCritique: string;
  confidenceBeforePeerUpdate: number;
  confidenceAfterPeerUpdate: number;
  readyToDecide: boolean;
  isVote: boolean;
  voteChoice: string | null;
}

export interface AuditDecisionInfo {
  outcome: string;
  method: "CONSENSUS" | "MAJORITY_VOTE";
  dissent: { agentDisplayName: string; reason: string }[];
  untestedAssumption: string;
  likelyFailureMode: string;
}

function formatAuditTranscript(turns: AuditTranscriptTurn[]): string {
  if (turns.length === 0) return "(no turns)";
  return turns
    .map((t, i) => {
      const parts = [
        `Turn ${i + 1} -- ${t.speakerDisplayName}${t.isVote ? " (forced-vote round)" : ""}:`,
        t.message,
        `  [weakness stated: ${t.weaknessCritique}]`,
        `  [confidence before peers: ${t.confidenceBeforePeerUpdate.toFixed(2)} -> after: ${t.confidenceAfterPeerUpdate.toFixed(2)}]`,
        `  [ready to decide: ${t.readyToDecide}]`,
      ];
      if (t.isVote) parts.push(`  [voted: ${t.voteChoice ?? "(none recorded)"}]`);
      return parts.join("\n");
    })
    .join("\n\n");
}

function formatAuditDecision(decision: AuditDecisionInfo): string {
  const dissentBlock =
    decision.dissent.length > 0
      ? `\nDissent recorded: ${decision.dissent.map((d) => `${d.agentDisplayName} -- ${d.reason}`).join("; ")}`
      : "";
  return `Final outcome: ${decision.outcome}
Resolution method: ${decision.method === "CONSENSUS" ? "Organic consensus" : "Forced majority vote"}${dissentBlock}
Root-cause pass already extracted -- untested assumption: ${decision.untestedAssumption}
If that assumption is wrong: ${decision.likelyFailureMode}`;
}

export async function runExpertAudit(
  apiKey: string,
  modelId: string,
  runId: string,
  turns: AuditTranscriptTurn[],
  decision: AuditDecisionInfo,
): Promise<{ result: ExpertAuditResult; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const prompt = `Transcript leading to this decision:\n\n${formatAuditTranscript(turns)}\n\n---\n\n${formatAuditDecision(decision)}\n\n---\n\nAudit this decision.`;

  // See structuredOutput.ts's callStructuredOutput for why this goes
  // through client.messages.create() plus manual parsing rather than
  // .parse() (which throws away stop_reason/usage/raw text on any
  // parse/validation failure).
  const { data, inputTokens, outputTokens } = await callStructuredOutput({
    client,
    params: {
      model: modelId,
      max_tokens: 4000,
      system: EXPERT_AUDIT_SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(expertAuditSchema) },
      messages: [{ role: "user", content: prompt }],
    },
    schema: expertAuditSchema,
    timeoutMs: AUDIT_TIMEOUT_MS,
    label: "Expert audit call",
    source: "expertAudit",
    runId,
  });
  return { result: data, inputTokens, outputTokens };
}
