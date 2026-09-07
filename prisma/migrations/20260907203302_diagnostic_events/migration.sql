-- CreateTable
CREATE TABLE "DiagnosticEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "runId" TEXT,
    "message" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "DiagnosticEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagnosticEvent_createdAt_idx" ON "DiagnosticEvent"("createdAt");
