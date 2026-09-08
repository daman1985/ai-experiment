import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logDiagnostic } from "@/lib/diagnostics";
import { getProviderAdapter, computeCostUsd } from "./index";
import { buildSystemPrompt, roomLabel } from "./prompt";
import {
  extractConsensusOutcome,
  extractRootCauseCheck,
  extractVoteTally,
} from "./decisionExtraction";
import type { DocumentForPrompt, TranscriptEntryForPrompt } from "./schema";
import type { Agent, Prisma, ProviderConfig, Run } from "@prisma/client";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

async function documentsForAgent(runId: string, agentId: string): Promise<DocumentForPrompt[]> {
  const docs = await prisma.document.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
  return docs
    .filter((d) => d.sharedWithAll || (isStringArray(d.accessAgentIds) && d.accessAgentIds.includes(agentId)))
    .map((d) => ({ filename: d.filename, kind: d.kind, mimeType: d.mimeType, content: d.content }));
}

export interface AdvanceResult {
  action:
    | "noop"
    | "stopped"
    | "deactivated"
    | "error"
    | "turn_taken"
    | "decision_reached"
    | "run_completed";
  detail?: string;
}

function toEncryptedPayload(config: ProviderConfig) {
  return { encrypted: config.encryptedApiKey, iv: config.iv, authTag: config.authTag };
}

// A single advanceRunLocked call can now legitimately run a turn
// (research + turn, up to ~100s, see MIN_TURN_BUDGET_MS below) and then,
// if that turn happens to complete a consensus, immediately attempt the
// extraction chain too (up to ~50s, see MIN_EXTRACTION_BUDGET_MS) --
// worst case, one call's real duration approaches ~150s. This has to
// stay comfortably above that, or a call that's still legitimately
// running gets treated as an abandoned/crashed lock and a second caller
// (the cron tick and "watch live" can race) starts a duplicate LLM call.
const STALE_LOCK_MS = 200_000;

// Worst case for the LLM turn call path (research timeout + turn timeout,
// see providers/anthropic.ts et al) plus margin. Confirmed directly
// against production with the app's real prompts (not placeholder
// content) that a real web-search research call can legitimately take
// ~35s and genuinely original turn reasoning ~24s -- raised well past
// both. A caller sharing one hard deadline across multiple runs (the
// cron tick) needs this to decide whether there's enough of the deadline
// left to even start a turn.
//
// Raised a second time (65s -> 115s once RESEARCH_TIMEOUT_MS/
// TURN_TIMEOUT_MS above are added in) alongside TURN_TIMEOUT_MS's own
// 35s -> 60s bump in the provider adapters -- see anthropic.ts's comment
// on that change. Must stay above RESEARCH_TIMEOUT_MS + TURN_TIMEOUT_MS
// (100s) with real margin, since nothing gates the turn call itself once
// started; this is only checked before starting one.
export const MIN_TURN_BUDGET_MS = 115_000;
// Worst case for two sequential extraction calls (outcome + root-cause,
// or vote tally + root-cause, see decisionExtraction.ts) plus margin.
// Checked against the *shared* deadline, not a fresh budget, before
// attempting either extraction chain -- see the deadlineAt threading
// below. If it doesn't fit, the extraction is skipped this call and
// retried on the next one: checkConsensus/handleForcedVoteTurn re-derive
// "is everyone ready/voted" from stored turns each time, so nothing is
// lost by deferring, just delayed.
export const MIN_EXTRACTION_BUDGET_MS = 55_000;

// One call = one turn (or one budget/consensus housekeeping step) for a
// single run. Designed to be cheap and idempotent-ish to call repeatedly
// -- it re-derives whose turn it is from stored turns each time rather
// than trusting any other in-memory state. Two different callers can
// legitimately race to advance the same run (the cron tick and an
// admin's "watch live" polling both call this), so the actual work
// happens under a claimed lock; a caller that loses the race gets a
// harmless noop back instead of paying for a duplicate LLM call.
//
// deadlineAt is an absolute epoch-ms deadline, not a fresh per-call
// budget -- critical when a caller (the cron tick) processes multiple
// runs against one shared hard function timeout: each run must know how
// much of *that same* deadline is left, not assume it gets a full fresh
// allotment. Defaults to a fresh budget for callers with their own
// separate invocation (e.g. the "watch live" admin action), which don't
// share a deadline with anything else -- must exceed MIN_TURN_BUDGET_MS
// with margin, or this default would defeat itself by leaving no room to
// actually attempt a turn. Raised from 90s to 170s alongside
// MIN_TURN_BUDGET_MS's own bump to 115s, so this default still clears it
// with room for the extraction chain afterward -- see the route calling
// this with its own maxDuration for the matching platform-level timeout.
export async function advanceRun(
  runId: string,
  deadlineAt: number = Date.now() + 170_000,
): Promise<AdvanceResult> {
  const claimed = await prisma.run.updateMany({
    where: {
      id: runId,
      status: "ACTIVE",
      OR: [{ isAdvancing: false }, { advancingSince: { lt: new Date(Date.now() - STALE_LOCK_MS) } }],
    },
    data: { isAdvancing: true, advancingSince: new Date() },
  });
  if (claimed.count === 0) {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run) return { action: "noop", detail: "run not found" };
    if (run.status !== "ACTIVE") return { action: "noop", detail: `run status is ${run.status}` };
    return { action: "noop", detail: "already advancing (another call is in flight)" };
  }
  try {
    return await advanceRunLocked(runId, deadlineAt);
  } finally {
    await prisma.run.update({ where: { id: runId }, data: { isAdvancing: false } });
  }
}

async function turnsSinceLastDecision(run: Pick<Run, "id" | "extendedAtSequenceNumber">): Promise<number> {
  const lastDecision = await prisma.decision.findFirst({
    where: { runId: run.id },
    orderBy: { afterSequenceNumber: "desc" },
  });
  const baseline = Math.max(lastDecision?.afterSequenceNumber ?? 0, run.extendedAtSequenceNumber);
  return prisma.turn.count({
    where: { runId: run.id, sequenceNumber: { gt: baseline } },
  });
}

// Merges agent turns and admin chat messages into one chronological
// transcript by createdAt -- an AdminMessage doesn't share Turn's
// sequenceNumber space (it's outside the round-cap/rotation machinery
// entirely, see the schema comment), so timestamp order is what actually
// determines where it reads as having been said.
async function fullTranscript(runId: string): Promise<TranscriptEntryForPrompt[]> {
  const [turns, adminMessages] = await Promise.all([
    prisma.turn.findMany({
      where: { runId },
      orderBy: { sequenceNumber: "asc" },
      include: { agent: true, yieldToAgent: true },
    }),
    prisma.adminMessage.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
  ]);
  const turnEntries = turns.map((t) => ({
    at: t.createdAt,
    entry: {
      speakerRoomLabel: roomLabel(t.agent.seatIndex),
      message: t.message,
      weaknessCritique: t.weaknessCritique,
      readyToDecide: t.readyToDecide,
      yieldToRoomLabel: t.yieldToAgent ? roomLabel(t.yieldToAgent.seatIndex) : null,
      isVote: t.isVote,
      voteChoice: t.voteChoice,
    },
  }));
  const adminEntries = adminMessages.map((m) => ({
    at: m.createdAt,
    entry: {
      speakerRoomLabel: "Admin",
      message: m.message,
      weaknessCritique: "",
      readyToDecide: false,
      yieldToRoomLabel: null,
      isVote: false,
      voteChoice: null,
      isAdminMessage: true,
    },
  }));
  return [...turnEntries, ...adminEntries]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((e) => e.entry);
}

async function advanceRunLocked(runId: string, deadlineAt: number): Promise<AdvanceResult> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { agents: { orderBy: { seatIndex: "asc" } } },
  });
  if (!run) return { action: "noop", detail: "run not found" };
  if (run.status !== "ACTIVE") return { action: "noop", detail: `run status is ${run.status}` };

  const providerConfigs = await prisma.providerConfig.findMany();
  const configByProvider = new Map(providerConfigs.map((c) => [c.provider, c]));

  const totalSpend =
    run.agents.reduce((sum, a) => sum + Number(a.spendUsd), 0) + Number(run.systemSpendUsd);
  if (totalSpend >= Number(run.totalBudgetCapUsd)) {
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "STOPPED_BUDGET", endedAt: new Date() },
    });
    return { action: "stopped", detail: "total run budget exceeded" };
  }

  let activeAgents: Agent[] = run.agents.filter((a) => a.isActive);
  if (activeAgents.length < 2) {
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "STOPPED_BUDGET", endedAt: new Date() },
    });
    return { action: "stopped", detail: "fewer than 2 active agents remain" };
  }

  const turnsSinceDecision = await turnsSinceLastDecision(run);
  // The starting seat rotates by round (rather than always seat 0) so no
  // single agent gets a permanent first-mover/anchoring advantage -- see
  // docs/design-system.md and the September 2026 model-selection research
  // on debate anchoring. Rounds are counted since the last decision (or
  // the run's start), not since some admin-defined phase boundary -- the
  // conversation is one continuous room.
  const roundNumberForTurn = Math.floor(turnsSinceDecision / activeAgents.length);
  const normalSpeakerIndex = (turnsSinceDecision + roundNumberForTurn) % activeAgents.length;
  const normalSpeaker = activeAgents[normalSpeakerIndex];

  let speaker = normalSpeaker;
  if (run.pendingYieldToAgentId) {
    const yieldTarget = activeAgents.find((a) => a.id === run.pendingYieldToAgentId);
    if (yieldTarget) speaker = yieldTarget;
  }

  if (Number(speaker.spendUsd) >= Number(speaker.budgetCapUsd)) {
    await prisma.agent.update({ where: { id: speaker.id }, data: { isActive: false } });
    return {
      action: "deactivated",
      detail: `${speaker.displayName} hit its budget cap; next tick continues with the remaining agents`,
    };
  }

  const config = configByProvider.get(speaker.provider);
  if (!config) {
    return {
      action: "error",
      detail: `No API key configured for ${speaker.provider}. Add one in admin settings.`,
    };
  }
  const apiKey = decrypt(toEncryptedPayload(config));

  const transcript = await fullTranscript(run.id);

  const priorDecisionRows = await prisma.decision.findMany({
    where: { runId: run.id },
    orderBy: { decidedAt: "asc" },
  });
  const priorDecisions = priorDecisionRows.map((d) => ({ outcome: d.outcome }));

  const selfRoomLabel = roomLabel(speaker.seatIndex);
  const otherRoomLabels = activeAgents
    .filter((a) => a.id !== speaker.id)
    .map((a) => roomLabel(a.seatIndex));
  const isForcedVote = run.forcedVotePending;
  const enableResearch = run.allowsResearch || isForcedVote;

  const systemPrompt = buildSystemPrompt({
    selfRoomLabel,
    otherRoomLabels,
    topic: run.topic,
    isForcedVote,
    forcedVoteRoundCap: run.forcedVoteRoundCap,
    priorDecisions,
  });

  const documents = await documentsForAgent(run.id, speaker.id);

  const adapter = getProviderAdapter(speaker.provider);
  await logDiagnostic({
    source: "advanceRunLocked",
    level: "info",
    runId: run.id,
    message: `calling ${speaker.provider} (${speaker.modelId}), research=${enableResearch}, docs=${documents.length}`,
  });
  const llmCallStart = Date.now();
  const result = await adapter.runTurn({
    runId: run.id,
    apiKey,
    modelId: speaker.modelId,
    systemPrompt,
    transcript,
    selfRoomLabel,
    otherRoomLabels,
    enableResearch,
    isForcedVote,
    documents,
  });
  await logDiagnostic({
    source: "advanceRunLocked",
    level: "info",
    runId: run.id,
    message: `${speaker.provider} call took ${Date.now() - llmCallStart}ms`,
  });

  const costUsd = computeCostUsd({
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    inputPricePerMillion: Number(config.inputPricePerMillion),
    outputPricePerMillion: Number(config.outputPricePerMillion),
  });

  const yieldTargetAgent = result.output.yieldToRoomLabel
    ? activeAgents.find(
        (a) => roomLabel(a.seatIndex) === result.output.yieldToRoomLabel && a.id !== speaker.id,
      )
    : undefined;

  const maxSeq = await prisma.turn.aggregate({
    where: { runId: run.id },
    _max: { sequenceNumber: true },
  });
  const nextSequenceNumber = (maxSeq._max.sequenceNumber ?? 0) + 1;

  const writeStart = Date.now();
  await prisma.$transaction(async (tx) => {
    const createdTurn = await tx.turn.create({
      data: {
        runId: run.id,
        agentId: speaker.id,
        roundNumber: roundNumberForTurn,
        sequenceNumber: nextSequenceNumber,
        message: result.output.message,
        weaknessCritique: result.output.weaknessCritique,
        confidenceBeforePeerUpdate: result.output.confidenceBeforePeerUpdate,
        confidenceAfterPeerUpdate: result.output.confidenceAfterPeerUpdate,
        readyToDecide: result.output.readyToDecide,
        runComplete: result.output.runComplete,
        yieldToAgentId: yieldTargetAgent?.id ?? null,
        isVote: isForcedVote,
        voteChoice: isForcedVote ? result.output.voteChoice : null,
        toolCalls:
          result.toolCalls.length > 0
            ? (result.toolCalls as unknown as Prisma.InputJsonValue)
            : undefined,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
      },
    });

    await tx.agent.update({
      where: { id: speaker.id },
      data: { spendUsd: { increment: costUsd } },
    });

    if (result.output.artifact) {
      await tx.artifact.create({
        data: {
          runId: run.id,
          type: result.output.artifact.type,
          title: result.output.artifact.title,
          content: result.output.artifact.content,
          createdByAgentId: speaker.id,
          turnId: createdTurn.id,
        },
      });
    }

    await tx.run.update({
      where: { id: run.id },
      data: {
        pendingYieldToAgentId: yieldTargetAgent?.id ?? null,
        roundNumber: roundNumberForTurn,
      },
    });
  });
  await logDiagnostic({
    source: "advanceRunLocked",
    level: "info",
    runId: run.id,
    message: `turn #${nextSequenceNumber} written in ${Date.now() - writeStart}ms`,
  });

  const updatedSpeaker = await prisma.agent.findUniqueOrThrow({ where: { id: speaker.id } });
  if (Number(updatedSpeaker.spendUsd) >= Number(updatedSpeaker.budgetCapUsd)) {
    await prisma.agent.update({ where: { id: speaker.id }, data: { isActive: false } });
  }

  activeAgents = (
    await prisma.agent.findMany({ where: { runId: run.id }, orderBy: { seatIndex: "asc" } })
  ).filter((a) => a.isActive);

  if (isForcedVote) {
    return handleForcedVoteTurn(run, activeAgents, configByProvider, speaker, deadlineAt);
  }

  const consensusResult = await checkConsensus(run, activeAgents, configByProvider, deadlineAt);
  if (consensusResult) return consensusResult;

  const turnsSinceDecisionNow = turnsSinceDecision + 1;
  if (turnsSinceDecisionNow >= run.forcedVoteRoundCap * activeAgents.length) {
    await prisma.run.update({ where: { id: run.id }, data: { forcedVotePending: true } });
    return {
      action: "turn_taken",
      detail: `${speaker.displayName} spoke; round cap reached, next round is a forced vote`,
    };
  }

  return { action: "turn_taken", detail: `${speaker.displayName} spoke` };
}

async function latestTurnStateByAgent(runId: string, activeAgents: Agent[]) {
  const recent = await prisma.turn.findMany({
    where: { runId, isVote: false },
    orderBy: { sequenceNumber: "desc" },
    take: activeAgents.length * 2,
  });
  const latest = new Map<string, { readyToDecide: boolean; runComplete: boolean }>();
  for (const t of recent) {
    if (!latest.has(t.agentId)) {
      latest.set(t.agentId, { readyToDecide: t.readyToDecide, runComplete: t.runComplete });
    }
  }
  return latest;
}

// Marks the run finished once a resolved decision's participants all
// signaled runComplete -- otherwise clears the forced-vote/rotation state
// so the same continuous conversation carries on toward its next decision.
async function finishDecision(
  runId: string,
  allAgentsSignaledComplete: boolean,
): Promise<AdvanceResult["action"]> {
  if (allAgentsSignaledComplete) {
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        forcedVotePending: false,
        pendingYieldToAgentId: null,
      },
    });
    return "run_completed";
  }
  await prisma.run.update({
    where: { id: runId },
    data: { forcedVotePending: false, pendingYieldToAgentId: null, roundNumber: 0 },
  });
  return "decision_reached";
}

async function checkConsensus(
  run: Run,
  activeAgents: Agent[],
  configByProvider: Map<string, ProviderConfig>,
  deadlineAt: number,
): Promise<AdvanceResult | null> {
  const latest = await latestTurnStateByAgent(run.id, activeAgents);
  const allReady = activeAgents.every((a) => latest.get(a.id)?.readyToDecide === true);
  if (!allReady) return null;

  if (deadlineAt - Date.now() < MIN_EXTRACTION_BUDGET_MS) {
    await logDiagnostic({
      source: "checkConsensus",
      level: "info",
      runId: run.id,
      message: "consensus reached but budget too tight for extraction this tick -- deferring",
    });
    return {
      action: "turn_taken",
      detail: "Consensus reached; outcome extraction deferred to the next tick (budget tight).",
    };
  }

  const anthropicConfig = configByProvider.get("ANTHROPIC");
  if (!anthropicConfig) {
    return {
      action: "error",
      detail: "Consensus reached but no Anthropic key is configured for outcome extraction.",
    };
  }
  const anthropicKey = decrypt(toEncryptedPayload(anthropicConfig));
  const transcript = await fullTranscript(run.id);

  let t0 = Date.now();
  const extraction = await extractConsensusOutcome(anthropicKey, transcript);
  await logDiagnostic({
    source: "checkConsensus",
    level: "info",
    runId: run.id,
    message: `outcome extraction took ${Date.now() - t0}ms`,
  });
  await recordSystemCost(run.id, extraction, anthropicConfig);
  t0 = Date.now();
  const rootCause = await extractRootCauseCheck(anthropicKey, transcript, extraction.result.outcome);
  await logDiagnostic({
    source: "checkConsensus",
    level: "info",
    runId: run.id,
    message: `root-cause extraction took ${Date.now() - t0}ms`,
  });
  await recordSystemCost(run.id, rootCause, anthropicConfig);

  const maxSeq = await prisma.turn.aggregate({
    where: { runId: run.id },
    _max: { sequenceNumber: true },
  });
  await prisma.decision.create({
    data: {
      runId: run.id,
      outcome: extraction.result.outcome,
      method: "CONSENSUS",
      afterSequenceNumber: maxSeq._max.sequenceNumber ?? 0,
      untestedAssumption: rootCause.result.untestedAssumption,
      likelyFailureMode: rootCause.result.likelyFailureMode,
    },
  });

  const allComplete = activeAgents.every((a) => latest.get(a.id)?.runComplete === true);
  const action = await finishDecision(run.id, allComplete);
  return {
    action,
    detail:
      action === "run_completed"
        ? "The room reached consensus and signaled the topic is fully resolved."
        : "Decision recorded by consensus; the conversation continues.",
  };
}

async function handleForcedVoteTurn(
  run: Run,
  activeAgents: Agent[],
  configByProvider: Map<string, ProviderConfig>,
  speaker: Agent,
  deadlineAt: number,
): Promise<AdvanceResult> {
  const recentVotes = await prisma.turn.findMany({
    where: { runId: run.id, isVote: true },
    orderBy: { sequenceNumber: "desc" },
    take: activeAgents.length * 2,
    include: { agent: true },
  });
  const latestVoteByAgent = new Map<
    string,
    { agentDisplayName: string; voteChoice: string; runComplete: boolean }
  >();
  for (const t of recentVotes) {
    if (!latestVoteByAgent.has(t.agentId) && t.voteChoice) {
      latestVoteByAgent.set(t.agentId, {
        agentDisplayName: t.agent.displayName,
        voteChoice: t.voteChoice,
        runComplete: t.runComplete,
      });
    }
  }
  const allVoted = activeAgents.every((a) => latestVoteByAgent.has(a.id));
  if (!allVoted) {
    return {
      action: "turn_taken",
      detail: `${speaker.displayName} voted; waiting on ${activeAgents.length - latestVoteByAgent.size} more`,
    };
  }

  if (deadlineAt - Date.now() < MIN_EXTRACTION_BUDGET_MS) {
    await logDiagnostic({
      source: "handleForcedVoteTurn",
      level: "info",
      runId: run.id,
      message: "all votes in but budget too tight for extraction this tick -- deferring",
    });
    return {
      action: "turn_taken",
      detail: "All votes are in; tally extraction deferred to the next tick (budget tight).",
    };
  }

  const anthropicConfig = configByProvider.get("ANTHROPIC");
  if (!anthropicConfig) {
    return {
      action: "error",
      detail: "All votes are in but no Anthropic key is configured for tally extraction.",
    };
  }
  const anthropicKey = decrypt(toEncryptedPayload(anthropicConfig));
  const votes = Array.from(latestVoteByAgent.values());
  let t0 = Date.now();
  const tally = await extractVoteTally(anthropicKey, votes);
  await logDiagnostic({
    source: "handleForcedVoteTurn",
    level: "info",
    runId: run.id,
    message: `tally took ${Date.now() - t0}ms`,
  });
  await recordSystemCost(run.id, tally, anthropicConfig);

  const transcript = await fullTranscript(run.id);
  t0 = Date.now();
  const rootCause = await extractRootCauseCheck(anthropicKey, transcript, tally.result.outcome);
  await logDiagnostic({
    source: "handleForcedVoteTurn",
    level: "info",
    runId: run.id,
    message: `root-cause extraction took ${Date.now() - t0}ms`,
  });
  await recordSystemCost(run.id, rootCause, anthropicConfig);

  const maxSeq = await prisma.turn.aggregate({
    where: { runId: run.id },
    _max: { sequenceNumber: true },
  });
  await prisma.decision.create({
    data: {
      runId: run.id,
      outcome: tally.result.outcome,
      method: "MAJORITY_VOTE",
      dissent: tally.result.dissent,
      afterSequenceNumber: maxSeq._max.sequenceNumber ?? 0,
      untestedAssumption: rootCause.result.untestedAssumption,
      likelyFailureMode: rootCause.result.likelyFailureMode,
    },
  });

  const allComplete = activeAgents.every((a) => latestVoteByAgent.get(a.id)?.runComplete === true);
  const action = await finishDecision(run.id, allComplete);
  return {
    action,
    detail:
      action === "run_completed"
        ? "The room resolved a forced vote and signaled the topic is fully resolved."
        : "Decision recorded by forced majority vote; the conversation continues.",
  };
}

async function recordSystemCost(
  runId: string,
  extraction: { inputTokens: number; outputTokens: number },
  config: ProviderConfig,
) {
  const cost = computeCostUsd({
    inputTokens: extraction.inputTokens,
    outputTokens: extraction.outputTokens,
    inputPricePerMillion: Number(config.inputPricePerMillion),
    outputPricePerMillion: Number(config.outputPricePerMillion),
  });
  await prisma.run.update({ where: { id: runId }, data: { systemSpendUsd: { increment: cost } } });
}
