-- CreateEnum
CREATE TYPE "SondageStatus" AS ENUM ('BROUILLON', 'ACTIF', 'FERME');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TEXT_SHORT', 'TEXT_LONG', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RATING', 'YES_NO');

-- CreateTable
CREATE TABLE "Sondage" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "SondageStatus" NOT NULL DEFAULT 'BROUILLON',
    "recipientMode" TEXT NOT NULL DEFAULT 'ALL',
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sondage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SondageQuestion" (
    "id" TEXT NOT NULL,
    "sondageId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "options" JSONB,
    "condition" JSONB,

    CONSTRAINT "SondageQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SondageRecipient" (
    "sondageId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,

    CONSTRAINT "SondageRecipient_pkey" PRIMARY KEY ("sondageId","membreId")
);

-- CreateTable
CREATE TABLE "SondageReponse" (
    "id" TEXT NOT NULL,
    "sondageId" TEXT NOT NULL,
    "membreId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SondageReponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SondageReponseItem" (
    "id" TEXT NOT NULL,
    "reponseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "SondageReponseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SondageReponse_sondageId_membreId_key" ON "SondageReponse"("sondageId", "membreId");

-- AddForeignKey
ALTER TABLE "Sondage" ADD CONSTRAINT "Sondage_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SondageQuestion" ADD CONSTRAINT "SondageQuestion_sondageId_fkey" FOREIGN KEY ("sondageId") REFERENCES "Sondage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SondageRecipient" ADD CONSTRAINT "SondageRecipient_sondageId_fkey" FOREIGN KEY ("sondageId") REFERENCES "Sondage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SondageRecipient" ADD CONSTRAINT "SondageRecipient_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SondageReponse" ADD CONSTRAINT "SondageReponse_sondageId_fkey" FOREIGN KEY ("sondageId") REFERENCES "Sondage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SondageReponse" ADD CONSTRAINT "SondageReponse_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SondageReponseItem" ADD CONSTRAINT "SondageReponseItem_reponseId_fkey" FOREIGN KEY ("reponseId") REFERENCES "SondageReponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SondageReponseItem" ADD CONSTRAINT "SondageReponseItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SondageQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
