-- Fase 4 do pedido do Leandro: dados de contato da associação, visíveis ao público na página
-- do evento — mesmo par de campos que MembershipForm/DonationForm já têm.

-- AlterTable
ALTER TABLE "Evenement" ADD COLUMN "contactEmail" TEXT,
ADD COLUMN "contactPhone" TEXT;
