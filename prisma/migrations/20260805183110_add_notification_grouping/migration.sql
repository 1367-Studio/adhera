-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "groupKey" TEXT;

-- CreateIndex
CREATE INDEX "Notification_userId_groupKey_read_idx" ON "Notification"("userId", "groupKey", "read");
