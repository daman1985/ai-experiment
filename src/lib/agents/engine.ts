import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProviderAdapter, computeCostUsd } from "./index";
import { buildSystemPrompt } from "./prompt";
import {
  extractConsensusOutcome,
  extractRoleAssignment,
  extractVoteTally,
} from "./decisionExtraction";
import type { TranscriptEntryForPrompt } from "./schema";
import type { Agent, Phase, Prisma, ProviderConfig } from "@prisma/client";

export interface AdvanceResult {
  action:
    | "noop"
    | "stopped"
    | "deactivated"
    | "error"
    | "turn_taken"
    | "phase_resolved";
  detail?: string;
}

function toEncryptedPayload(config: ProviderConfig) {
  return { encrypted: config.encryptedApiKey, iv: config.iv, authTag: config.authTag };
}

// One call = one turn (or one budget/consensus housekeeping step) for a
// single run. Designed to be cheap and idempotent-ish to call repeatedly
// from a cron tick -- it re-derives whose turn it is from stored turns
// each time rather than trusting any other in-memory state.
export async function advanceRun(runId: string): Promise<AdvanceResult> {
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

  const turnsSoFarInPhase = await prisma.turn.count({
    where: { runId: run.id, phase: run.currentPhase },
  });
  const normalSpeaker = activeAgents[turnsSoFarInPhase % activeAgents.length];

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

  const priorTurns = await prisma.turn.findMany({
    where: { runId: run.id, phase: run.currentPhase },
    orderBy: { sequenceNumber: "asc" },
    include: { agent: true, yieldToAgent: true },
  });
  const transcript: TranscriptEntryForPrompt[] = priorTurns.map((t) => ({
    speakerDisplayName: t.agent.displayName,
    message: t.message,
    weaknessCritique: t.weaknessCritique,
    readyToDecide: t.readyToDecide,
    yieldToDisplayName: t.yieldToAgent?.displayName ?? null,
    isVote: t.isVote,
    voteChoice: t.voteChoice,
  }));

  const otherDisplayNames = activeAgents
    .filter((a) => a.id !== speaker.id)
    .map((a) => a.displayName);
  const isForcedVote = run.forcedVotePending;
  const enableResearch = run.currentPhase !== "OPERATION" || isForcedVote;

  const systemPrompt = buildSystemPrompt({
    selfDisplayName: speaker.displayName,
    otherDisplayNames,
    phase: run.currentPhase,
    isForcedVote,
    roundCapPerPhase: run.roundCapPerPhase,
  });

  const adapter = getProviderAdapter(speaker.provider);
  const result = await adapter.runTurn({
    apiKey,
    modelId: speaker.modelId,
    systemPrompt,
    transcript,
    selfDisplayName: speaker.displayName,
    otherDisplayNames,
    enableResearch,
    isForcedVote,
  });

  const costUsd = computeCostUsd({
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    inputPricePerMillion: Number(config.inputPricePerMillion),
    outputPricePerMillion: Number(config.outputPricePerMillion),
  });

  const yieldTargetAgent = result.output.yieldToDisplayName
    ? activeAgents.find(
        (a) => a.displayName === result.output.yieldToDisplayName && a.id !== speaker.id,
      )
    : undefined;

  const roundNumberForTurn = Math.floor(turnsSoFarInPhase / activeAgents.length);
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
        phase: run.currentPhase,
        roundNumber: roundNumberForTurn,
        sequenceNumber: nextSequenceNumber,
        message: result.output.message,
        weaknessCritique: result.output.weaknessCritique,
        readyToDecide: result.output.readyToDecide,
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
          phase: run.currentPhase,
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
    return handleForcedVoteTurn(run.id, run.currentPhase, activeAgents, configByProvider, speaker);
  }

  if (run.currentPhase === "IDEATION" || run.currentPhase === "ROLE_ASSIGNMENT") {
    const consensusResult = await checkConsensus(
      run.id,
      run.currentPhase,
      activeAgents,
      configByProvider,
    );
    if (consensusResult) return consensusResult;

    const turnsInPhaseNow = turnsSoFarInPhase + 1;
    if (turnsInPhaseNow >= run.roundCapPerPhase * activeAgents.length) {
      await prisma.run.update({ where: { id: run.id }, data: { forcedVotePending: true } });
      return {
        action: "turn_taken",
        detail: `${speaker.displayName} spoke; round cap reached, next round is a forced vote`,
      };
    }
  }

  return { action: "turn_taken", detail: `${speaker.displayName} spoke` };
}

async function latestReadyStateByAgent(runId: string, phase: Phase, activeAgents: Agent[]) {
  const recent = await prisma.turn.findMany({
    where: { runId, phase, isVote: false },
    orderBy: { sequenceNumber: "desc" },
    take: activeAgents.length * 2,
  });
  const latest = new Map<string, boolean>();
  for (const t of recent) {
    if (!latest.has(t.agentId)) latest.set(t.agentId, t.readyToDecide);
  }
  return latest;
}

async function checkConsensus(
  runId: string,
  phase: Phase,
  activeAgents: Agent[],
  configByProvider: Map<string, ProviderConfig>,
): Promise<AdvanceResult | null> {
  const latest = await latestReadyStateByAgent(runId, phase, activeAgents);
  const allReady = activeAgents.every((a) => latest.get(a.id) === true);
  if (!allReady) return null;

  const anthropicConfig = configByProvider.get("ANTHROPIC");
  if (!anthropicConfig) {
    return {
      action: "error",
      detail: "Consensus reached but no Anthropic key is configured for outcome extraction.",
    };
  }
  const anthropicKey = decrypt(toEncryptedPayload(anthropicConfig));

  const priorTurns = await prisma.turn.findMany({
    where: { runId, phase },
    orderBy: { sequenceNumber: "asc" },
    include: { agent: true, yieldToAgent: true },
  });
  const transcript: TranscriptEntryForPrompt[] = priorTurns.map((t) => ({
    speakerDisplayName: t.agent.displayName,
    message: t.message,
    weaknessCritique: t.weaknessCritique,
    readyToDecide: t.readyToDecide,
    yieldToDisplayName: t.yieldToAgent?.displayName ?? null,
    isVote: t.isVote,
    voteChoice: t.voteChoice,
  }));

  if (phase === "IDEATION") {
    const extraction = await extractConsensusOutcome(anthropicKey, transcript);
    await recordSystemCost(runId, extraction, anthropicConfig);
    await prisma.decision.create({
      data: { runId, phase, outcome: extraction.result.outcome, method: "CONSENSUS" },
    });
    await advanceToNextPhase(runId, "IDEATION");
    return { action: "phase_resolved", detail: "Business idea decided by consensus." };
  }

  // ROLE_ASSIGNMENT
  const extraction = await extractRoleAssignment(anthropicKey, transcript);
  await recordSystemCost(runId, extraction, anthropicConfig);
  await prisma.decision.create({
    data: { runId, phase, outcome: extraction.result.outcome, method: "CONSENSUS" },
  });
  for (const roleAssignment of extraction.result.roles) {
    const agent = activeAgents.find((a) => a.displayName === roleAssignment.agentDisplayName);
    if (agent) {
      await prisma.agent.update({
        where: { id: agent.id },
        data: { assignedRole: roleAssignment.role },
      });
    }
  }
  await advanceToNextPhase(runId, "ROLE_ASSIGNMENT");
  return { action: "phase_resolved", detail: "Roles decided by consensus." };
}

async function handleForcedVoteTurn(
  runId: string,
  phase: Phase,
  activeAgents: Agent[],
  configByProvider: Map<string, ProviderConfig>,
  speaker: Agent,
): Promise<AdvanceResult> {
  const recentVotes = await prisma.turn.findMany({
    where: { runId, phase, isVote: true },
    orderBy: { sequenceNumber: "desc" },
    take: activeAgents.length * 2,
    include: { agent: true },
  });
  const latestVoteByAgent = new Map<string, { agentDisplayName: string; voteChoice: string }>();
  for (const t of recentVotes) {
    if (!latestVoteByAgent.has(t.agentId) && t.voteChoice) {
      latestVoteByAgent.set(t.agentId, {
        agentDisplayName: t.agent.displayName,
        voteChoice: t.voteChoice,
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
  await recordSystemCost(runId, tally, anthropicConfig);

  await prisma.decision.create({
    data: {
      runId,
      phase,
      outcome: tally.result.outcome,
      method: "MAJORITY_VOTE",
      dissent: tally.result.dissent,
    },
  });

  // Known v1 limitation: a forced vote on ROLE_ASSIGNMENT records the
  // winning outcome as text but does not attempt to parse it back into
  // per-agent assignedRole fields the way the consensus path does --
  // deadlock lasting the full round cap is the rare case, and the
  // structured-vote-with-roles parsing isn't worth building for it yet.
  await advanceToNextPhase(runId, phase);
  return { action: "phase_resolved", detail: `${phase} resolved by forced majority vote.` };
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

async function advanceToNextPhase(runId: string, resolvedPhase: Phase) {
  const nextPhase: Phase = resolvedPhase === "IDEATION" ? "ROLE_ASSIGNMENT" : "OPERATION";
  await prisma.run.update({
    where: { id: runId },
    data: { currentPhase: nextPhase, forcedVotePending: false, pendingYieldToAgentId: null, roundNumber: 0 },
  });
}
