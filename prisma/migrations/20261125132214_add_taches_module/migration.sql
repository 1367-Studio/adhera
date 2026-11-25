-- CreateEnum
CREATE TYPE "TacheStatus" AS ENUM ('A_FAIRE', 'EN_COURS', 'TERMINEE');

-- CreateEnum
CREATE TYPE "TacheReminderDirection" AS ENUM ('AVANT', 'APRES');

-- CreateTable
CREATE TABLE "TacheCategorie" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TacheCategorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tache" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "categorieId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "TacheStatus" NOT NULL DEFAULT 'A_FAIRE',
    "completedAt" TIMESTAMP(3),
    "completedByMembreId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "linkBackHref" TEXT,
    "linkBackLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TacheAssignee" (
    "id" TEXT NOT NULL,
    "tacheId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TacheAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TacheReminder" (
    "id" TEXT NOT NULL,
    "tacheId" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "direction" "TacheReminderDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TacheReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TacheReminderLog" (
    "id" TEXT NOT NULL,
    "tacheId" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "direction" "TacheReminderDirection" NOT NULL,
    "membreId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TacheReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TacheCategorie_associationId_archivedAt_idx" ON "TacheCategorie"("associationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TacheCategorie_associationId_nom_key" ON "TacheCategorie"("associationId", "nom");

-- CreateIndex
CREATE INDEX "Tache_associationId_status_idx" ON "Tache"("associationId", "status");

-- CreateIndex
CREATE INDEX "Tache_associationId_dueDate_idx" ON "Tache"("associationId", "dueDate");

-- CreateIndex
CREATE INDEX "Tache_associationId_categorieId_idx" ON "Tache"("associationId", "categorieId");

-- CreateIndex
CREATE UNIQUE INDEX "TacheAssignee_tacheId_membreId_key" ON "TacheAssignee"("tacheId", "membreId");

-- CreateIndex
CREATE UNIQUE INDEX "TacheReminder_tacheId_offsetDays_direction_key" ON "TacheReminder"("tacheId", "offsetDays", "direction");

-- CreateIndex
CREATE INDEX "TacheReminderLog_tacheId_sentAt_idx" ON "TacheReminderLog"("tacheId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TacheReminderLog_tacheId_offsetDays_direction_membreId_key" ON "TacheReminderLog"("tacheId", "offsetDays", "direction", "membreId");

-- AddForeignKey
ALTER TABLE "TacheCategorie" ADD CONSTRAINT "TacheCategorie_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "TacheCategorie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tache" ADD CONSTRAINT "Tache_completedByMembreId_fkey" FOREIGN KEY ("completedByMembreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacheAssignee" ADD CONSTRAINT "TacheAssignee_tacheId_fkey" FOREIGN KEY ("tacheId") REFERENCES "Tache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacheAssignee" ADD CONSTRAINT "TacheAssignee_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacheReminder" ADD CONSTRAINT "TacheReminder_tacheId_fkey" FOREIGN KEY ("tacheId") REFERENCES "Tache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacheReminderLog" ADD CONSTRAINT "TacheReminderLog_tacheId_fkey" FOREIGN KEY ("tacheId") REFERENCES "Tache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacheReminderLog" ADD CONSTRAINT "TacheReminderLog_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;
