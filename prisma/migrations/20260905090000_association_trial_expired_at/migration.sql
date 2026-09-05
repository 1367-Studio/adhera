-- Card-free signup: Stripe now cancels a trial that ends without a payment method. This
-- marks that case on the association so the locked-out screens can say "essai terminé"
-- rather than "abonnement résilié".

-- AlterTable
ALTER TABLE "Association" ADD COLUMN "trialExpiredAt" TIMESTAMP(3);
