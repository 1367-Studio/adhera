-- Security audit M3/H6 follow-up — the retention-sweep cron creates an ErasureRequest with no
-- human requester (the system, not an admin or the member), so requestedById must accept null.
ALTER TABLE "ErasureRequest" ALTER COLUMN "requestedById" DROP NOT NULL;
