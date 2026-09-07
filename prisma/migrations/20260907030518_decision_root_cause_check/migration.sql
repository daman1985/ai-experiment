/*
  Warnings:

  - Added the required column `likelyFailureMode` to the `Decision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `untestedAssumption` to the `Decision` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "likelyFailureMode" TEXT NOT NULL,
ADD COLUMN     "untestedAssumption" TEXT NOT NULL;
