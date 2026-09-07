/*
  Warnings:

  - You are about to drop the column `phase` on the `Artifact` table. All the data in the column will be lost.
  - You are about to drop the column `phase` on the `Decision` table. All the data in the column will be lost.
  - You are about to drop the column `currentPhase` on the `Run` table. All the data in the column will be lost.
  - You are about to drop the column `roundCapPerPhase` on the `Run` table. All the data in the column will be lost.
  - You are about to drop the column `phase` on the `Turn` table. All the data in the column will be lost.
  - Added the required column `phaseId` to the `Artifact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phaseId` to the `Decision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `topic` to the `Run` table without a default value. This is not possible if the table is not empty.
  - Added the required column `confidenceAfterPeerUpdate` to the `Turn` table without a default value. This is not possible if the table is not empty.
  - Added the required column `confidenceBeforePeerUpdate` to the `Turn` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phaseId` to the `Turn` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Artifact" DROP COLUMN "phase",
ADD COLUMN     "phaseId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Decision" DROP COLUMN "phase",
ADD COLUMN     "phaseId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Run" DROP COLUMN "currentPhase",
DROP COLUMN "roundCapPerPhase",
ADD COLUMN     "currentPhaseIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topic" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Turn" DROP COLUMN "phase",
ADD COLUMN     "confidenceAfterPeerUpdate" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "confidenceBeforePeerUpdate" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "phaseId" TEXT NOT NULL;

-- DropEnum
DROP TYPE "Phase";

-- CreateTable
CREATE TABLE "RunPhase" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "guidance" TEXT NOT NULL,
    "roundCapPerPhase" INTEGER NOT NULL DEFAULT 10,
    "assignsRoles" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RunPhase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunPhase_runId_orderIndex_key" ON "RunPhase"("runId", "orderIndex");

-- AddForeignKey
ALTER TABLE "RunPhase" ADD CONSTRAINT "RunPhase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "RunPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "RunPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "RunPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
