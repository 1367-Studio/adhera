-- The expected payment method for a Facture (e.g. "Virement"), distinct from
-- FacturePayment.method which records how a payment was actually settled after the fact.
-- Printed on the PDF so the client knows how they're expected to pay before anything is paid.

-- AlterTable
ALTER TABLE "Facture" ADD COLUMN "paymentMethod" TEXT;
