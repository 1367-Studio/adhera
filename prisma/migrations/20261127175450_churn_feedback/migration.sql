-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "subscriptionCancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChurnFeedback" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "reason" TEXT,
    "detail" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ChurnFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChurnFeedback_associationId_key" ON "ChurnFeedback"("associationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChurnFeedback_token_key" ON "ChurnFeedback"("token");

-- AddForeignKey
ALTER TABLE "ChurnFeedback" ADD CONSTRAINT "ChurnFeedback_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;
