/*
  Warnings:

  - You are about to drop the column `assignedRole` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `phaseId` on the `Artifact` table. All the data in the column will be lost.
  - You are about to drop the column `phaseId` on the `Decision` table. All the data in the column will be lost.
  - You are about to drop the column `currentPhaseIndex` on the `Run` table. All the data in the column will be lost.
  - You are about to drop the column `phaseId` on the `Turn` table. All the data in the column will be lost.
  - You are about to drop the `RunPhase` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `afterSequenceNumber` to the `Decision` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Artifact" DROP CONSTRAINT "Artifact_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "RunPhase" DROP CONSTRAINT "RunPhase_runId_fkey";

-- DropForeignKey
ALTER TABLE "Turn" DROP CONSTRAINT "Turn_phaseId_fkey";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "assignedRole";

-- AlterTable
ALTER TABLE "Artifact" DROP COLUMN "phaseId";

-- AlterTable
ALTER TABLE "Decision" DROP COLUMN "phaseId",
ADD COLUMN     "afterSequenceNumber" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Run" DROP COLUMN "currentPhaseIndex",
ADD COLUMN     "allowsResearch" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "forcedVoteRoundCap" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "Turn" DROP COLUMN "phaseId",
ADD COLUMN     "runComplete" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "RunPhase";
