-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "advancingSince" TIMESTAMP(3),
ADD COLUMN     "isAdvancing" BOOLEAN NOT NULL DEFAULT false;
