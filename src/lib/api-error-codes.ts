// Machine-readable error codes returned alongside { error: string } on some API routes,
// for UI that needs to react specifically (e.g. showing an "upgrade" action button)
// rather than just displaying the message. Deliberately dependency-free (no Prisma/Stripe
// imports) so it's safe to import from client components — unlike src/lib/plan-limits.ts.
export const MEMBER_LIMIT_ERROR_CODE = "MEMBER_LIMIT_REACHED"
