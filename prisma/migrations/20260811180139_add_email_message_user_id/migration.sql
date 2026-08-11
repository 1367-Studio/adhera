-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "EmailMessage_associationId_source_createdAt_idx" ON "EmailMessage"("associationId", "source", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
