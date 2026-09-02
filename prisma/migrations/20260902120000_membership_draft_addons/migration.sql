-- Carries the paid options / embedded donation chosen alongside a group signup through to the
-- Stripe webhook, the same way `products` already does. Nullable and additive: existing drafts
-- (and the single-registrant path, which rides in Stripe metadata instead) are unaffected.
ALTER TABLE "MembershipCheckoutDraft" ADD COLUMN "addons" JSONB;
