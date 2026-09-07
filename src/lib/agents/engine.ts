import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProviderAdapter, computeCostUsd } from "./index";
import { buildSystemPrompt, roomLabel } from "./prompt";
import {
  extractConsensusOutcome,
  extractRootCauseCheck,
  extractVoteTally,
} from "./decisionExtraction";
import type { TranscriptEntryForPrompt } from "./schema";
import type { Agent, Prisma, ProviderConfig, Run } from "@prisma/client";

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

// Generous relative to the route's own maxDuration (60s) -- long enough
// that a genuinely in-flight call is never preempted, short enough that a
// crashed invocation's lock doesn't stay stuck for the rest of the run.
const STALE_LOCK_MS = 90_000;

// One call = one turn (or one budget/consensus housekeeping step) for a
// single run. Designed to be cheap and idempotent-ish to call repeatedly
// -- it re-derives whose turn it is from stored turns each time rather
// than trusting any other in-memory state. Two different callers can
// legitimately race to advance the same run (the cron tick and an
// admin's "watch live" polling both call this), so the actual work
// happens under a claimed lock; a caller that loses the race gets a
// harmless noop back instead of paying for a duplicate LLM call.
export async function advanceRun(runId: string): Promise<AdvanceResult> {
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
    return await advanceRunLocked(runId);
  } finally {
    await prisma.run.update({ where: { id: runId }, data: { isAdvancing: false } });
  }
}

async function turnsSinceLastDecision(runId: string): Promise<number> {
  const lastDecision = await prisma.decision.findFirst({
    where: { runId },
    orderBy: { afterSequenceNumber: "desc" },
  });
  return prisma.turn.count({
    where: { runId, sequenceNumber: { gt: lastDecision?.afterSequenceNumber ?? 0 } },
  });
}

async function fullTranscript(runId: string): Promise<TranscriptEntryForPrompt[]> {
  const turns = await prisma.turn.findMany({
    where: { runId },
    orderBy: { sequenceNumber: "asc" },
    include: { agent: true, yieldToAgent: true },
  });
  return turns.map((t) => ({
    speakerRoomLabel: roomLabel(t.agent.seatIndex),
    message: t.message,
    weaknessCritique: t.weaknessCritique,
    readyToDecide: t.readyToDecide,
    yieldToRoomLabel: t.yieldToAgent ? roomLabel(t.yieldToAgent.seatIndex) : null,
    isVote: t.isVote,
    voteChoice: t.voteChoice,
  }));
}

async function advanceRunLocked(runId: string): Promise<AdvanceResult> {
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

  const turnsSinceDecision = await turnsSinceLastDecision(run.id);
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

  const adapter = getProviderAdapter(speaker.provider);
  const result = await adapter.runTurn({
    apiKey,
    modelId: speaker.modelId,
    systemPrompt,
    transcript,
    selfRoomLabel,
    otherRoomLabels,
    enableResearch,
    isForcedVote,
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

  const updatedSpeaker = await prisma.agent.findUniqueOrThrow({ where: { id: speaker.id } });
  if (Number(updatedSpeaker.spendUsd) >= Number(updatedSpeaker.budgetCapUsd)) {
    await prisma.agent.update({ where: { id: speaker.id }, data: { isActive: false } });
  }

  activeAgents = (
    await prisma.agent.findMany({ where: { runId: run.id }, orderBy: { seatIndex: "asc" } })
  ).filter((a) => a.isActive);

  if (isForcedVote) {
    return handleForcedVoteTurn(run, activeAgents, configByProvider, speaker);
  }

  const consensusResult = await checkConsensus(run, activeAgents, configByProvider);
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
): Promise<AdvanceResult | null> {
  const latest = await latestTurnStateByAgent(run.id, activeAgents);
  const allReady = activeAgents.every((a) => latest.get(a.id)?.readyToDecide === true);
  if (!allReady) return null;

  const anthropicConfig = configByProvider.get("ANTHROPIC");
  if (!anthropicConfig) {
    return {
      action: "error",
      detail: "Consensus reached but no Anthropic key is configured for outcome extraction.",
    };
  }
  const anthropicKey = decrypt(toEncryptedPayload(anthropicConfig));
  const transcript = await fullTranscript(run.id);

  const extraction = await extractConsensusOutcome(anthropicKey, transcript);
  await recordSystemCost(run.id, extraction, anthropicConfig);
  const rootCause = await extractRootCauseCheck(anthropicKey, transcript, extraction.result.outcome);
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

  const anthropicConfig = configByProvider.get("ANTHROPIC");
  if (!anthropicConfig) {
    return {
      action: "error",
      detail: "All votes are in but no Anthropic key is configured for tally extraction.",
    };
  }
  const anthropicKey = decrypt(toEncryptedPayload(anthropicConfig));
  const votes = Array.from(latestVoteByAgent.values());
  const tally = await extractVoteTally(anthropicKey, votes);
  await recordSystemCost(run.id, tally, anthropicConfig);

  const transcript = await fullTranscript(run.id);
  const rootCause = await extractRootCauseCheck(anthropicKey, transcript, tally.result.outcome);
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
