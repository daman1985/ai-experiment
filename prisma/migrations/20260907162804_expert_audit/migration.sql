-- CreateEnum
CREATE TYPE "AuditVerdict" AS ENUM ('PASS', 'MIXED', 'FAIL');

-- CreateTable
CREATE TABLE "ExpertAudit" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "verdict" "AuditVerdict" NOT NULL,
    "verdictRationale" TEXT NOT NULL,
    "fatalFlaws" JSONB NOT NULL,
    "residualLossDetected" JSONB NOT NULL,
    "explorationGainScore" INTEGER NOT NULL,
    "explorationGainNote" TEXT NOT NULL,
    "informationGainScore" INTEGER NOT NULL,
    "informationGainNote" TEXT NOT NULL,
    "aggregationGainScore" INTEGER NOT NULL,
    "aggregationGainNote" TEXT NOT NULL,
    "redTeamInjection" TEXT NOT NULL,
    "productGaps" JSONB NOT NULL,
    "topRecommendation" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpertAudit_decisionId_key" ON "ExpertAudit"("decisionId");

-- AddForeignKey
ALTER TABLE "ExpertAudit" ADD CONSTRAINT "ExpertAudit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertAudit" ADD CONSTRAINT "ExpertAudit_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
