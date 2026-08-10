-- CreateEnum
CREATE TYPE "MeetingSignatureStatus" AS ENUM ('DRAFT', 'ONGOING', 'DONE', 'EXPIRED', 'CANCELLED', 'DECLINED');

-- CreateEnum
CREATE TYPE "MeetingSignerStatus" AS ENUM ('NOTIFIED', 'VIEWED', 'SIGNED', 'DECLINED', 'ERROR');

-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "youtrustApiKey" TEXT,
ADD COLUMN     "youtrustWebhookSecret" TEXT;

-- CreateTable
CREATE TABLE "MeetingSignatureRequest" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "status" "MeetingSignatureStatus" NOT NULL DEFAULT 'DRAFT',
    "youtrustRequestId" TEXT,
    "pdfUrl" TEXT,
    "signedPdfUrl" TEXT,
    "auditTrailUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingSignatureSigner" (
    "id" TEXT NOT NULL,
    "signatureRequestId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "youtrustSignerId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "MeetingSignerStatus" NOT NULL DEFAULT 'NOTIFIED',
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSignatureSigner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSignatureRequest_meetingId_key" ON "MeetingSignatureRequest"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSignatureSigner_signatureRequestId_membreId_key" ON "MeetingSignatureSigner"("signatureRequestId", "membreId");

-- AddForeignKey
ALTER TABLE "MeetingSignatureRequest" ADD CONSTRAINT "MeetingSignatureRequest_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSignatureSigner" ADD CONSTRAINT "MeetingSignatureSigner_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "MeetingSignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSignatureSigner" ADD CONSTRAINT "MeetingSignatureSigner_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;
