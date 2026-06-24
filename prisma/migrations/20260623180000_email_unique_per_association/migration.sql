-- DropIndex
DROP INDEX "User_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_email_associationId_key" ON "User"("email", "associationId");
