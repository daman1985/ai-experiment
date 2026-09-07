"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { advanceRun } from "@/lib/agents/engine";
import { decrypt } from "@/lib/crypto";
import { computeCostUsd } from "@/lib/agents";
import { runExpertAudit, type AuditTranscriptTurn } from "@/lib/agents/expertAudit";
import type { Prisma } from "@prisma/client";

// Lets an admin watching this run's page pump it forward faster than the
// 10-minute cron cadence, without changing the cron schedule itself --
// see LiveWatchToggle. Reuses the exact same advanceRun the cron route
// calls (including its overlap lock), so this can never take a turn out
// of turn or double up with a cron tick that fires at the same moment.
// Gated by the same admin session as the rest of /runs/:path* (see
// src/proxy.ts) since this executes against the current page's route.
export async function advanceRunNowAction(runId: string): Promise<void> {
  await advanceRun(runId);
}

const MAX_ADMIN_MESSAGE_LENGTH = 4000;

// Lets the admin actually speak in the room instead of only observing or
// steering indirectly (documents, forcing a vote) -- see AdminMessage in
// schema.prisma for why this deliberately sits outside the round-cap and
// rotation machinery: posting one is instant (no LLM call, no lock to
// contend with advanceRun for) and never changes whose turn is next. The
// next agent to speak, on whatever cadence already applies, reads it in
// their transcript like anything else that's been said.
export async function postAdminMessageAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId"));
  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    throw new Error("Message can't be empty.");
  }
  if (message.length > MAX_ADMIN_MESSAGE_LENGTH) {
    throw new Error(`Message is too long -- ${MAX_ADMIN_MESSAGE_LENGTH} characters max.`);
  }
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run || run.status !== "ACTIVE") {
    throw new Error("Can only post to an active run.");
  }
  await prisma.adminMessage.create({ data: { runId, message } });
  revalidatePath(`/runs/${runId}`);
}

// Skips straight to a forced vote instead of waiting for the round cap --
// the room resolves this specific disagreement on the next round rather
// than the admin needing to wait out however many rounds are left.
export async function forceVoteNowAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId"));
  await prisma.run.updateMany({
    where: { id: runId, status: "ACTIVE" },
    data: { forcedVotePending: true },
  });
  revalidatePath(`/runs/${runId}`);
}

// The other half of "force a decision now": give the room a fresh
// round-cap window from this exact moment. Same action whether it's
// cancelling an about-to-happen forced vote (the room wasn't actually
// stuck, just running long) or reopening a run that already completed
// (runComplete fired -- see prompt.ts -- when the topic wasn't really
// finished) -- both just mean "keep going," so both reduce to the same
// three fields: status back to ACTIVE, the forced-vote flag cleared, and
// the round-cap clock reset to now via extendedAtSequenceNumber.
export async function extendRoundsAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId"));
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  // Only meaningful for a run that's still going (cancelling an
  // about-to-happen vote) or one that just wrapped up (reopening it) --
  // a manually stopped or budget-exhausted run needs a real decision to
  // resume, not this button.
  if (!run || (run.status !== "ACTIVE" && run.status !== "COMPLETED")) return;

  const maxSeq = await prisma.turn.aggregate({
    where: { runId },
    _max: { sequenceNumber: true },
  });
  await prisma.run.update({
    where: { id: runId },
    data: {
      status: "ACTIVE",
      endedAt: null,
      forcedVotePending: false,
      pendingYieldToAgentId: null,
      roundNumber: 0,
      extendedAtSequenceNumber: maxSeq._max.sequenceNumber ?? 0,
    },
  });
  revalidatePath(`/runs/${runId}`);
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ALLOWED_TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json"];

// Browsers don't reliably set `type` for text-ish files (many report ""
// for .md), so extension is a real fallback here, not just a nicety.
function detectDocumentKind(file: File): "TEXT" | "IMAGE" | null {
  if (ALLOWED_IMAGE_MIME_TYPES.has(file.type)) return "IMAGE";
  const name = file.name.toLowerCase();
  if (ALLOWED_TEXT_MIME_TYPES.has(file.type) || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return "TEXT";
  }
  return null;
}

// Admin-side context injection, available any time a run is active --
// scoped to every agent by default, or a chosen subset. See
// documentsForAgent in lib/agents/engine.ts for how visibility is
// enforced when a turn's prompt is actually built.
export async function uploadDocumentAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId"));
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large -- ${MAX_FILE_BYTES / (1024 * 1024)}MB max.`);
  }

  const kind = detectDocumentKind(file);
  if (!kind) {
    throw new Error(
      "Unsupported file type -- text (.txt/.md/.csv/.json) and images (JPEG/PNG/GIF/WebP) are supported. PDFs and other document formats aren't yet.",
    );
  }

  const shareMode = String(formData.get("shareMode") ?? "all");
  const selectedAgentIds = formData.getAll("agentIds").map(String);
  if (shareMode === "specific" && selectedAgentIds.length === 0) {
    throw new Error('Pick at least one agent to share with, or choose "all".');
  }

  const content =
    kind === "IMAGE" ? Buffer.from(await file.arrayBuffer()).toString("base64") : await file.text();

  const maxSeq = await prisma.turn.aggregate({ where: { runId }, _max: { sequenceNumber: true } });

  await prisma.document.create({
    data: {
      runId,
      filename: file.name,
      mimeType: file.type || "text/plain",
      kind,
      content,
      sharedWithAll: shareMode !== "specific",
      accessAgentIds: shareMode === "specific" ? selectedAgentIds : undefined,
      introducedAfterSequenceNumber: maxSeq._max.sequenceNumber ?? 0,
    },
  });

  revalidatePath(`/runs/${runId}`);
}

interface DissentEntry {
  agentId: string;
  reason: string;
}

function isDissentArray(value: unknown): value is DissentEntry[] {
  return (
    Array.isArray(value) &&
    value.every((v): v is DissentEntry => typeof v === "object" && v !== null && "agentId" in v && "reason" in v)
  );
}

// On-demand, per-decision audit by a model that never participated in the
// deliberation -- see lib/agents/expertAudit.ts for why this is worth
// doing at all (it's given confidence telemetry no participant, and no
// other extraction step, ever sees) and why it deliberately isn't wired
// into advanceRun: it's a heavier, admin-opted-into call that shouldn't
// compete with the cron tick's own 60s budget. Idempotent -- a decision
// can only have one ExpertAudit (see the unique decisionId), so a second
// click after one succeeded is a silent no-op rather than spending twice.
export async function runExpertAuditAction(formData: FormData): Promise<void> {
  const decisionId = String(formData.get("decisionId"));
  const decision = await prisma.decision.findUnique({
    where: { id: decisionId },
    include: { expertAudit: true },
  });
  if (!decision) throw new Error("Decision not found.");
  if (decision.expertAudit) return;

  const anthropicConfig = await prisma.providerConfig.findUnique({ where: { provider: "ANTHROPIC" } });
  if (!anthropicConfig) {
    throw new Error("Expert audit requires an Anthropic API key configured in admin settings.");
  }

  const [turns, agents] = await Promise.all([
    prisma.turn.findMany({
      where: { runId: decision.runId, sequenceNumber: { lte: decision.afterSequenceNumber } },
      orderBy: { sequenceNumber: "asc" },
      include: { agent: true },
    }),
    prisma.agent.findMany({ where: { runId: decision.runId } }),
  ]);
  const agentNameById = new Map(agents.map((a) => [a.id, a.displayName]));

  const auditTurns: AuditTranscriptTurn[] = turns.map((t) => ({
    speakerDisplayName: t.agent.displayName,
    message: t.message,
    weaknessCritique: t.weaknessCritique,
    confidenceBeforePeerUpdate: t.confidenceBeforePeerUpdate,
    confidenceAfterPeerUpdate: t.confidenceAfterPeerUpdate,
    readyToDecide: t.readyToDecide,
    isVote: t.isVote,
    voteChoice: t.voteChoice,
  }));

  const dissent = isDissentArray(decision.dissent) ? decision.dissent : [];
  const apiKey = decrypt({
    encrypted: anthropicConfig.encryptedApiKey,
    iv: anthropicConfig.iv,
    authTag: anthropicConfig.authTag,
  });

  const { result, inputTokens, outputTokens } = await runExpertAudit(
    apiKey,
    anthropicConfig.defaultModelId,
    auditTurns,
    {
      outcome: decision.outcome,
      method: decision.method,
      dissent: dissent.map((d) => ({
        agentDisplayName: agentNameById.get(d.agentId) ?? "Unknown",
        reason: d.reason,
      })),
      untestedAssumption: decision.untestedAssumption,
      likelyFailureMode: decision.likelyFailureMode,
    },
  );

  const costUsd = computeCostUsd({
    inputTokens,
    outputTokens,
    inputPricePerMillion: Number(anthropicConfig.inputPricePerMillion),
    outputPricePerMillion: Number(anthropicConfig.outputPricePerMillion),
  });

  await prisma.$transaction([
    prisma.expertAudit.create({
      data: {
        runId: decision.runId,
        decisionId: decision.id,
        verdict: result.verdict,
        verdictRationale: result.verdictRationale,
        fatalFlaws: result.fatalFlaws as unknown as Prisma.InputJsonValue,
        residualLossDetected: result.residualLossDetected as unknown as Prisma.InputJsonValue,
        explorationGainScore: result.explorationGain.score,
        explorationGainNote: result.explorationGain.note,
        informationGainScore: result.informationGain.score,
        informationGainNote: result.informationGain.note,
        aggregationGainScore: result.aggregationGain.score,
        aggregationGainNote: result.aggregationGain.note,
        redTeamInjection: result.redTeamInjection,
        productGaps: result.productGaps as unknown as Prisma.InputJsonValue,
        topRecommendation: result.topRecommendation,
        inputTokens,
        outputTokens,
        costUsd,
      },
    }),
    prisma.run.update({
      where: { id: decision.runId },
      data: { systemSpendUsd: { increment: costUsd } },
    }),
  ]);

  revalidatePath(`/runs/${decision.runId}`);
}
