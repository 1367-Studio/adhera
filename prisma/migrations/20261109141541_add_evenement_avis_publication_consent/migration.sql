-- AlterTable
ALTER TABLE "EvenementAvis" ADD COLUMN     "publicationAgreedAt" TIMESTAMP(3),
ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuredOnSite" BOOLEAN NOT NULL DEFAULT false;
