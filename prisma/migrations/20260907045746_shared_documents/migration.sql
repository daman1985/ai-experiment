-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('TEXT', 'IMAGE');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "content" TEXT NOT NULL,
    "sharedWithAll" BOOLEAN NOT NULL DEFAULT true,
    "accessAgentIds" JSONB,
    "introducedAfterSequenceNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
