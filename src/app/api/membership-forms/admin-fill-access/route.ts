import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"

// Lets the public adhésion form's admin-fill mode (membership-form-public-form.tsx's
// isAdminFill) check the caller's permission before rendering the form, instead of only
// finding out at the very last step — a manager without this would fill in every field and
// only then hit the generic 403 that POST .../admin-registration returns. Same gate as that
// route; this is a read-only preview of it, nothing is created or looked up here.
export const GET = withAdminAuth(
  async () => NextResponse.json({ allowed: true }),
  { area: "adhesions", access: "edit", module: "cotisations" },
)
