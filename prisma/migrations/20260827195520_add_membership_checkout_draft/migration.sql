-- CreateTable
CREATE TABLE "MembershipCheckoutDraft" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "conditionsAgreedAt" TIMESTAMP(3),
    "termsAcceptedIp" TEXT,
    "registrants" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "MembershipCheckoutDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipCheckoutDraft_associationId_idx" ON "MembershipCheckoutDraft"("associationId");

-- CreateIndex
CREATE INDEX "MembershipCheckoutDraft_formId_idx" ON "MembershipCheckoutDraft"("formId");

-- CreateIndex
CREATE INDEX "MembershipCheckoutDraft_expiresAt_idx" ON "MembershipCheckoutDraft"("expiresAt");

-- AddForeignKey
ALTER TABLE "MembershipCheckoutDraft" ADD CONSTRAINT "MembershipCheckoutDraft_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCheckoutDraft" ADD CONSTRAINT "MembershipCheckoutDraft_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MembershipForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
