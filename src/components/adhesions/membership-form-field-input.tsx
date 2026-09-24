"use client"

import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"

export type MembershipFormFieldInputField = {
  id:       string
  type:     "TEXT" | "NUMBER" | "SELECT"
  label:    string
  required: boolean
  options:  string[] | null
}

type MembershipFormFieldInputProps = {
  field:    MembershipFormFieldInputField
  value:    string
  onChange: (value: string) => void
  onBlur?:  () => void
  error?:   string
  // Overrides the SELECT trigger's id — needed wherever the same field.id repeats on screen
  // (the public form's registrants 2..N), so two triggers never share one DOM id.
  id?:      string
}

// A MembershipFormField only ever has 3 shapes (TEXT/NUMBER/SELECT — see MembershipFieldType
// in schema.prisma). Shared by the public adhésion form (single and multi-registrant) and the
// manager's "Editar membro" screen, so the three can never render — or validate — a field
// differently from one another.
export function MembershipFormFieldInput({ field, value, onChange, onBlur, error, id }: MembershipFormFieldInputProps) {
  if (field.type === "SELECT") {
    return (
      // SelectField doesn't expose onBlur — the wrapping div catches the trigger button's
      // blur (React's synthetic onBlur bubbles), so the field turns red on leave like every
      // other required field, instead of staying silent until a submit attempt.
      <div onBlur={onBlur}>
        <SelectField
          id={id ?? `custom-${field.id}`}
          label={field.label}
          required={field.required}
          options={(field.options ?? []).map(option => ({ value: option, label: option }))}
          value={value}
          onValueChange={onChange}
          error={error}
        />
      </div>
    )
  }

  return (
    <FormField
      label={field.label}
      required={field.required}
      type={field.type === "NUMBER" ? "number" : "text"}
      value={value}
      onChange={event => onChange(event.target.value)}
      onBlur={onBlur}
      error={error}
    />
  )
}
