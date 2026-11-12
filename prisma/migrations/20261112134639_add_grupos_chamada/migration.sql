-- CreateEnum
CREATE TYPE "ChamadaPresencaStatus" AS ENUM ('NAO_INFORMADO', 'PRESENTE', 'AUSENTE', 'AUSENCIA_JUSTIFICADA');

-- CreateTable
CREATE TABLE "Grupo" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grupo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrupoMembre" (
    "id" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrupoMembre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrupoResponsavel" (
    "id" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrupoResponsavel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChamadaSessao" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "horario" TEXT,
    "atividade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChamadaSessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChamadaPresenca" (
    "id" TEXT NOT NULL,
    "chamadaSessaoId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "status" "ChamadaPresencaStatus" NOT NULL DEFAULT 'NAO_INFORMADO',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChamadaPresenca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Grupo_associationId_archivedAt_idx" ON "Grupo"("associationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrupoMembre_grupoId_membreId_key" ON "GrupoMembre"("grupoId", "membreId");

-- CreateIndex
CREATE UNIQUE INDEX "GrupoResponsavel_grupoId_userId_key" ON "GrupoResponsavel"("grupoId", "userId");

-- CreateIndex
CREATE INDEX "ChamadaSessao_grupoId_data_idx" ON "ChamadaSessao"("grupoId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "ChamadaPresenca_chamadaSessaoId_membreId_key" ON "ChamadaPresenca"("chamadaSessaoId", "membreId");

-- AddForeignKey
ALTER TABLE "Grupo" ADD CONSTRAINT "Grupo_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "Association"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoMembre" ADD CONSTRAINT "GrupoMembre_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "Grupo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoMembre" ADD CONSTRAINT "GrupoMembre_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoResponsavel" ADD CONSTRAINT "GrupoResponsavel_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "Grupo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoResponsavel" ADD CONSTRAINT "GrupoResponsavel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChamadaSessao" ADD CONSTRAINT "ChamadaSessao_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "Grupo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChamadaPresenca" ADD CONSTRAINT "ChamadaPresenca_chamadaSessaoId_fkey" FOREIGN KEY ("chamadaSessaoId") REFERENCES "ChamadaSessao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChamadaPresenca" ADD CONSTRAINT "ChamadaPresenca_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
