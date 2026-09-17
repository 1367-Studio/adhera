-- CreateTable
CREATE TABLE "AssociationDocument" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibleToMembers" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssociationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssociationDocument_associationId_deletedAt_idx" ON "AssociationDocument"("associationId", "deletedAt");

-- CreateIndex
CREATE INDEX "AssociationDocument_associationId_visibleToMembers_idx" ON "AssociationDocument"("associationId", "visibleToMembers");

-- AddForeignKey
ALTER TABLE "AssociationDocument" ADD CONSTRAINT "AssociationDocument_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;
