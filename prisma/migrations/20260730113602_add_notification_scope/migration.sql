-- CreateEnum
CREATE TYPE "NotificationScope" AS ENUM ('MEMBRE', 'GESTION');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "scope" "NotificationScope" NOT NULL DEFAULT 'MEMBRE';

-- CreateIndex
CREATE INDEX "Notification_userId_scope_read_idx" ON "Notification"("userId", "scope", "read");
