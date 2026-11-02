-- Staff-set deadline to convert a negotiated PricingOffer still billing 0€ onto real
-- catalog pricing. Read by a new daily cron (subscription-grace-period-sweep) that
-- force-suspends the association once this date passes with no real payment on file —
-- a €0 subscription never naturally fails an invoice, so Stripe's own dunning can't be
-- relied on to enforce a deadline here.

-- AlterTable
ALTER TABLE "Association" ADD COLUMN "subscriptionGracePeriodEndsAt" TIMESTAMP(3);
