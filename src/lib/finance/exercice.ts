// src/lib/finance/exercice.ts
import { prisma } from "@/lib/prisma/client"

export async function resolveExerciceForDate(
  associationId: string,
  date: Date,
): Promise<string | null> {
  const exercice = await prisma.exerciceComptable.findFirst({
    where: {
      associationId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { id: true },
  })

  return exercice?.id ?? null
}
