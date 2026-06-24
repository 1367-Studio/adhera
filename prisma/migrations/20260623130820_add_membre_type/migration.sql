-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "typeId" TEXT;

-- CreateTable
CREATE TABLE "MembreType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "associationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembreType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembreType_name_associationId_key" ON "MembreType"("name", "associationId");

-- AddForeignKey
ALTER TABLE "MembreType" ADD CONSTRAINT "MembreType_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MembreType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
