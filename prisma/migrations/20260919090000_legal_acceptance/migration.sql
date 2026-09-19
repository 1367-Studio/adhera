-- CreateEnum
CREATE TYPE "LegalAcceptanceContext" AS ENUM ('ADHESION', 'DON', 'EVENEMENT', 'BOUTIQUE', 'PORTAL_REGISTER', 'PORTAL_REACCEPTANCE', 'DASHBOARD_OFFLINE');

-- AlterTable
ALTER TABLE "AssociationDocument" ADD COLUMN     "requiresAcceptance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AssociationDocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssociationDocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "userId" TEXT,
    "membreId" TEXT,
    "guestEmail" TEXT,
    "context" "LegalAcceptanceContext" NOT NULL,
    "contextId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "collectedById" TEXT,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssociationDocument_associationId_requiresAcceptance_idx" ON "AssociationDocument"("associationId", "requiresAcceptance");

-- CreateIndex
CREATE INDEX "AssociationDocumentRevision_documentId_createdAt_idx" ON "AssociationDocumentRevision"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssociationDocumentRevision_documentId_version_key" ON "AssociationDocumentRevision"("documentId", "version");

-- CreateIndex
CREATE INDEX "LegalAcceptance_associationId_acceptedAt_idx" ON "LegalAcceptance"("associationId", "acceptedAt");

-- CreateIndex
CREATE INDEX "LegalAcceptance_revisionId_idx" ON "LegalAcceptance"("revisionId");

-- CreateIndex
CREATE INDEX "LegalAcceptance_membreId_idx" ON "LegalAcceptance"("membreId");

-- CreateIndex
CREATE INDEX "LegalAcceptance_userId_idx" ON "LegalAcceptance"("userId");

-- CreateIndex
CREATE INDEX "LegalAcceptance_guestEmail_idx" ON "LegalAcceptance"("guestEmail");

-- AddForeignKey
ALTER TABLE "AssociationDocumentRevision" ADD CONSTRAINT "AssociationDocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AssociationDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AssociationDocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
