-- AlterTable
ALTER TABLE "AssociationDocument" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileUrl" TEXT;

-- AlterTable
ALTER TABLE "AssociationDocumentRevision" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileUrl" TEXT;
