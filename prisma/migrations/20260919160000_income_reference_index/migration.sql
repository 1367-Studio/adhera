-- Les webhooks Stripe lisent Income.reference à chaque facture payée (deux lookups par
-- invoice.paid, garde d'idempotence — voir isReferenceAlreadyRecorded) et à chaque
-- remboursement : sans index, chacun de ces appels faisait un seq scan sur toute la table
-- Income de la plateforme. Additif, aucune donnée touchée.

-- CreateIndex
CREATE INDEX "Income_associationId_reference_idx" ON "Income"("associationId", "reference");
