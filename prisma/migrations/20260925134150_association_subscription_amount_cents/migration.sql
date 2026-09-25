-- Tracks the current recurring price (in cents) of an Association's own Formwise
-- subscription, synced from Stripe — lets platformFeeRate() (src/lib/stripe.ts) tell a
-- genuinely-paying ACTIVE subscription apart from a PricingOffer whose current phase
-- bills 0€ forever, which Stripe also reports as ACTIVE.
-- AlterTable
ALTER TABLE "Association" ADD COLUMN     "subscriptionAmountCents" INTEGER;
