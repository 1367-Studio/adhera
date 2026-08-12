-- CreateTable
CREATE TABLE "Translation" (
    "hash" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "translated" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("hash","locale")
);
