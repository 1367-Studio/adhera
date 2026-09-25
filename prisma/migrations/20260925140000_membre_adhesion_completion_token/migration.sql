-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "adhesionCompletionToken" TEXT,
ADD COLUMN     "adhesionCompletionFormId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Membre_adhesionCompletionToken_key" ON "Membre"("adhesionCompletionToken");

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_adhesionCompletionFormId_fkey" FOREIGN KEY ("adhesionCompletionFormId") REFERENCES "MembershipForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
