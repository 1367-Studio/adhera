-- Back-office visibility into when each user last signed in / was last active (see the
-- comment on these fields in schema.prisma). Additive-only: two nullable columns, no
-- backfill — null means "never since this column existed".

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);
