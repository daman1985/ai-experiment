-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('ANTHROPIC', 'OPENAI', 'GOOGLE');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('IDEATION', 'ROLE_ASSIGNMENT', 'OPERATION');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'STOPPED_BUDGET', 'STOPPED_MANUAL', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DecisionMethod" AS ENUM ('CONSENSUS', 'MAJORITY_VOTE');

-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "defaultModelId" TEXT NOT NULL,
    "inputPricePerMillion" DECIMAL(10,4) NOT NULL,
    "outputPricePerMillion" DECIMAL(10,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'DRAFT',
    "currentPhase" "Phase" NOT NULL DEFAULT 'IDEATION',
    "pendingYieldToAgentId" TEXT,
    "roundNumber" INTEGER NOT NULL DEFAULT 0,
    "roundCapPerPhase" INTEGER NOT NULL DEFAULT 10,
    "forcedVotePending" BOOLEAN NOT NULL DEFAULT false,
    "totalBudgetCapUsd" DECIMAL(10,2) NOT NULL DEFAULT 90,
    "systemSpendUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "displayName" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "budgetCapUsd" DECIMAL(10,2) NOT NULL DEFAULT 30,
    "spendUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "assignedRole" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "weaknessCritique" TEXT NOT NULL,
    "readyToDecide" BOOLEAN NOT NULL DEFAULT false,
    "yieldToAgentId" TEXT,
    "isVote" BOOLEAN NOT NULL DEFAULT false,
    "voteChoice" TEXT,
    "toolCalls" JSONB,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "outcome" TEXT NOT NULL,
    "method" "DecisionMethod" NOT NULL,
    "dissent" JSONB,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfig_provider_key" ON "ProviderConfig"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_runId_seatIndex_key" ON "Agent"("runId", "seatIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_runId_provider_key" ON "Agent"("runId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_runId_sequenceNumber_key" ON "Turn"("runId", "sequenceNumber");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_yieldToAgentId_fkey" FOREIGN KEY ("yieldToAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
