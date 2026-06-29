-- CreateIndex
CREATE INDEX "Actualite_associationId_publishedAt_idx" ON "Actualite"("associationId", "publishedAt");

-- CreateIndex
CREATE INDEX "AutomationLog_ruleId_sentAt_idx" ON "AutomationLog"("ruleId", "sentAt");

-- CreateIndex
CREATE INDEX "AutomationLog_ruleId_eventId_idx" ON "AutomationLog"("ruleId", "eventId");

-- CreateIndex
CREATE INDEX "AutomationRule_associationId_status_idx" ON "AutomationRule"("associationId", "status");

-- CreateIndex
CREATE INDEX "AutomationRule_status_nextRunAt_idx" ON "AutomationRule"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "BoutiqueCommande_associationId_status_idx" ON "BoutiqueCommande"("associationId", "status");

-- CreateIndex
CREATE INDEX "Cotisation_associationId_status_idx" ON "Cotisation"("associationId", "status");

-- CreateIndex
CREATE INDEX "Don_associationId_paidAt_idx" ON "Don"("associationId", "paidAt");

-- CreateIndex
CREATE INDEX "Evenement_associationId_date_idx" ON "Evenement"("associationId", "date");

-- CreateIndex
CREATE INDEX "Material_associationId_status_idx" ON "Material"("associationId", "status");

-- CreateIndex
CREATE INDEX "MaterialLoan_materialId_returnedAt_idx" ON "MaterialLoan"("materialId", "returnedAt");

-- CreateIndex
CREATE INDEX "Meeting_associationId_idx" ON "Meeting"("associationId");

-- CreateIndex
CREATE INDEX "Membre_associationId_deletedAt_idx" ON "Membre"("associationId", "deletedAt");

-- CreateIndex
CREATE INDEX "Membre_associationId_status_idx" ON "Membre"("associationId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Participation_evenementId_idx" ON "Participation"("evenementId");

-- CreateIndex
CREATE INDEX "Sondage_associationId_status_idx" ON "Sondage"("associationId", "status");

-- CreateIndex
CREATE INDEX "TresorerieEntry_associationId_date_idx" ON "TresorerieEntry"("associationId", "date");

-- CreateIndex
CREATE INDEX "TresorerieEntry_associationId_type_idx" ON "TresorerieEntry"("associationId", "type");

-- CreateIndex
CREATE INDEX "User_associationId_role_idx" ON "User"("associationId", "role");
