import type { MembershipFieldType } from "@prisma/client"

export type MembershipFormFieldForValidation = {
  id:       string
  label:    string
  type:     MembershipFieldType
  required: boolean
  options:  unknown
}

export type MembershipFormAnswersError = {
  field: MembershipFormFieldForValidation
  kind:  "required" | "invalid_option"
}

// The required/SELECT-option matrix a MembershipFormField answer must satisfy — shared by the
// public checkout (single and multi-registrant), the admin-registration payment link, and a
// manager editing a member's answers, so the three can never silently drift on what "valid"
// means. Returns the first offending field, not every one — same behaviour every call site had
// on its own before this was extracted.
export function findInvalidMembershipFormAnswer(
  fields:  readonly MembershipFormFieldForValidation[],
  answers: Record<string, string | undefined>,
): MembershipFormAnswersError | null {
  for (const field of fields) {
    const value = answers[field.id]
    if (field.required && (value == null || value.trim() === "")) return { field, kind: "required" }
    if (field.type === "SELECT" && value != null && value !== "") {
      const options = Array.isArray(field.options) ? field.options as string[] : []
      if (!options.includes(value)) return { field, kind: "invalid_option" }
    }
  }
  return null
}
