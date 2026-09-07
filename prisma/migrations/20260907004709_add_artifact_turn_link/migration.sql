-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "turnId" TEXT;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
