-- Drop attendance tables from previous migration
DROP TABLE IF EXISTS "AttendanceEntry";
DROP TABLE IF EXISTS "AttendanceSheet";

-- Drop enums from previous migration
DROP TYPE IF EXISTS "SessionType";
DROP TYPE IF EXISTS "CheckInMethod";

-- Add QR fields to Evenement
ALTER TABLE "Evenement" ADD COLUMN "qrToken" TEXT;
ALTER TABLE "Evenement" ADD COLUMN "qrExpiresAt" TIMESTAMP(3);

-- Unique constraint on qrToken
CREATE UNIQUE INDEX "Evenement_qrToken_key" ON "Evenement"("qrToken");
