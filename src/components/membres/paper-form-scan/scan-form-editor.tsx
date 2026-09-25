"use client"

import { useTranslations } from "next-intl"
import { AddressFields } from "@/components/ui/address-fields"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { DateField } from "@/components/ui/date-field"
import { FormField } from "@/components/ui/form-field"
import { Label } from "@/components/ui/label"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import type { AddressFormValues } from "@/lib/address"
import {
  ageFromBirthDate,
  fullNameOf,
  hasGuardianInput,
  type DraftErrors,
  type DuplicateCheck,
  type DuplicateMatch,
  type ImageRightsChoice,
  type LowConfidenceKey,
  type ReviewDraft,
  type ScanForm,
} from "./scan-model"

// Low-confidence reading: the same amber the shared Badge `warning` variant uses, on the
// border only — enough to catch the eye without turning the form into a traffic light.
const LOW_CONFIDENCE_INPUT_CLASS = "border-amber-500/60 dark:border-amber-400/50"
const LOW_CONFIDENCE_TEXT_CLASS  = "text-xs text-amber-700 dark:text-amber-400"
const SECTION_TITLE_CLASS        = "text-sm font-medium"

const ADULT_AGE = 18

export type LegalDocumentOption = { id: string; title: string }

type TextDraftKey =
  | "firstName" | "lastName" | "email" | "phone"
  | "guardianName" | "guardianPhone" | "secondGuardianName" | "secondGuardianPhone"

type ScanFormEditorProps = {
  form:            ScanForm
  errors:          DraftErrors
  legalDocuments:  LegalDocumentOption[]
  readOnly:        boolean
  onDraftChange:   (patch: Partial<ReviewDraft>, editedKeys: LowConfidenceKey[]) => void
  onNameBlur:      () => void
}

function currentMatches(check: DuplicateCheck | null, firstName: string, lastName: string): DuplicateMatch[] {
  if (!check || check.checkedName !== fullNameOf(firstName, lastName)) return []
  return check.matches
}

function describeMatch(match: DuplicateMatch): string {
  const contact = match.email ?? match.phone
  return contact ? `${fullNameOf(match.firstName, match.lastName)} (${contact})` : fullNameOf(match.firstName, match.lastName)
}

export function ScanFormEditor({ form, errors, legalDocuments, readOnly, onDraftChange, onNameBlur }: ScanFormEditorProps) {
  const t     = useTranslations("paperFormScan.editor")
  const tRoot = useTranslations()
  const { draft } = form
  const lowConfidenceKeys = new Set(form.lowConfidence)
  const isLow = (key: LowConfidenceKey) => lowConfidenceKeys.has(key)
  const idPrefix = `scan-${form.formId}`

  const age     = ageFromBirthDate(draft.birthDate)
  const isMinor = age !== null && age < ADULT_AGE

  const studentMatches = currentMatches(form.studentDuplicates, draft.firstName, draft.lastName)

  const lowConfidenceHint = t("lowConfidence")

  function textFieldProps(key: TextDraftKey) {
    return {
      id:        `${idPrefix}-${key}`,
      value:     draft[key],
      disabled:  readOnly,
      error:     errors[key],
      hint:      isLow(key) ? lowConfidenceHint : undefined,
      className: isLow(key) && !errors[key] ? LOW_CONFIDENCE_INPUT_CLASS : undefined,
      onChange:  (event: React.ChangeEvent<HTMLInputElement>) => onDraftChange({ [key]: event.target.value }, [key]),
    }
  }

  const civiliteOptions = [
    { value: "",     label: tRoot("membres.form.civilite.none") },
    { value: "MME",  label: tRoot("membres.form.civilite.mme") },
    { value: "MLLE", label: tRoot("membres.form.civilite.mlle") },
    { value: "M",    label: tRoot("membres.form.civilite.m") },
  ]
  const sexeOptions = [
    { value: "",      label: tRoot("membres.form.sexe.none") },
    { value: "HOMME", label: tRoot("membres.form.sexe.homme") },
    { value: "FEMME", label: tRoot("membres.form.sexe.femme") },
  ]

  const addressIsLow = (["addressStreet", "addressComplement", "postalCode", "city", "country"] as const).some(isLow)
  const addressErrors: Partial<Record<keyof AddressFormValues, string>> = {
    addressStreet: errors.addressStreet, addressComplement: errors.addressComplement,
    postalCode: errors.postalCode, city: errors.city, country: errors.country,
  }

  return (
    // A container, not the viewport, drives the columns: at lg the editor is only a third of
    // the review screen, far narrower than the `sm:` breakpoint assumes.
    <div className="@container space-y-8">
      {/* ─── Identité ─── */}
      <section className="space-y-4">
        <h3 className={SECTION_TITLE_CLASS}>{t("identity")}</h3>
        <div className="grid gap-4 @sm:grid-cols-2">
          <FormField label={t("firstName")} required {...textFieldProps("firstName")} onBlur={onNameBlur} />
          <FormField label={t("lastName")} required {...textFieldProps("lastName")} onBlur={onNameBlur} />
        </div>
        {studentMatches.length > 0 && (
          <p className={LOW_CONFIDENCE_TEXT_CLASS}>
            {t("alreadyExists", { people: studentMatches.map(describeMatch).join(", ") })}
          </p>
        )}
        <div className="grid gap-4 @sm:grid-cols-2">
          <FormField label={t("email")} type="email" {...textFieldProps("email")} />
          <FormField label={t("phone")} type="tel" {...textFieldProps("phone")} />
        </div>
        <div className="grid gap-4 @sm:grid-cols-2 @xl:grid-cols-3">
          <DateField
            id={`${idPrefix}-birthDate`}
            label={t("birthDate")}
            value={draft.birthDate}
            disabled={readOnly}
            error={errors.birthDate}
            hint={isLow("birthDate") ? lowConfidenceHint : age !== null ? t("age", { age }) : undefined}
            className={isLow("birthDate") && !errors.birthDate ? LOW_CONFIDENCE_INPUT_CLASS : undefined}
            onChange={(value) => onDraftChange({ birthDate: value }, ["birthDate"])}
          />
          <div className="space-y-1.5">
            <SelectField
              id={`${idPrefix}-civilite`}
              label={t("civilite")}
              options={civiliteOptions}
              value={draft.civilite}
              disabled={readOnly}
              onValueChange={(value) => onDraftChange({ civilite: value as ReviewDraft["civilite"] }, ["civilite"])}
            />
            {isLow("civilite") && <p className={LOW_CONFIDENCE_TEXT_CLASS}>{lowConfidenceHint}</p>}
          </div>
          <div className="space-y-1.5">
            <SelectField
              id={`${idPrefix}-sexe`}
              label={t("sexe")}
              options={sexeOptions}
              value={draft.sexe}
              disabled={readOnly}
              onValueChange={(value) => onDraftChange({ sexe: value as ReviewDraft["sexe"] }, ["sexe"])}
            />
            {isLow("sexe") && <p className={LOW_CONFIDENCE_TEXT_CLASS}>{lowConfidenceHint}</p>}
          </div>
        </div>
      </section>

      {/* ─── Adresse ─── */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className={SECTION_TITLE_CLASS}>{t("address")}</h3>
          {addressIsLow && <p className={LOW_CONFIDENCE_TEXT_CLASS}>{t("addressLowConfidence")}</p>}
        </div>
        <AddressFields
          idPrefix={idPrefix}
          value={draft.address}
          disabled={readOnly}
          errors={addressErrors}
          onChange={(patch) => onDraftChange(
            { address: { ...draft.address, ...patch } },
            Object.keys(patch) as (keyof AddressFormValues)[],
          )}
        />
      </section>

      {/* ─── Responsables légaux ─── */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className={SECTION_TITLE_CLASS}>{t("guardians")}</h3>
          {/* A reminder only: a minor may still be created without any responsable. */}
          {isMinor && !hasGuardianInput(draft) && (
            <p className="text-xs text-muted-foreground">{t("guardianExpected", { age: age ?? 0 })}</p>
          )}
        </div>
        <div className="grid gap-4 @sm:grid-cols-2">
          <FormField label={t("guardianName", { number: 1 })} {...textFieldProps("guardianName")} />
          <FormField label={t("guardianPhone", { number: 1 })} type="tel" {...textFieldProps("guardianPhone")} />
        </div>
        <div className="grid gap-4 @sm:grid-cols-2">
          <FormField label={t("guardianName", { number: 2 })} {...textFieldProps("secondGuardianName")} />
          <FormField label={t("guardianPhone", { number: 2 })} type="tel" {...textFieldProps("secondGuardianPhone")} />
        </div>
      </section>

      {/* ─── Autorisations ─── */}
      <section className="space-y-4">
        <h3 className={SECTION_TITLE_CLASS}>{t("consents")}</h3>
        <div className="space-y-1.5">
          <Label>{t("imageRights")}</Label>
          <div>
            <SegmentedControl<ImageRightsChoice>
              size="sm"
              ariaLabel={t("imageRights")}
              value={draft.imageRights}
              disabled={readOnly}
              onChange={(value) => onDraftChange({ imageRights: value }, ["imageRights"])}
              options={[
                { value: "yes",     label: t("imageRightsYes") },
                { value: "no",      label: t("imageRightsNo") },
                { value: "unknown", label: t("imageRightsUnknown") },
              ]}
            />
          </div>
          {isLow("imageRights") && <p className={LOW_CONFIDENCE_TEXT_CLASS}>{lowConfidenceHint}</p>}
        </div>

        {legalDocuments.length > 0 && (
          <div className="space-y-2" role="group" aria-labelledby={`${idPrefix}-legal-documents-label`}>
            <Label id={`${idPrefix}-legal-documents-label`}>{t("legalDocuments")}</Label>
            {legalDocuments.map((legalDocument) => {
              const legalKey = `legal:${legalDocument.id}` as const
              return (
                <CheckboxField
                  key={legalDocument.id}
                  id={`${idPrefix}-legal-${legalDocument.id}`}
                  label={legalDocument.title}
                  description={isLow(legalKey) ? lowConfidenceHint : undefined}
                  checked={draft.acceptedLegalDocumentIds.includes(legalDocument.id)}
                  disabled={readOnly}
                  onChange={(event) => {
                    const otherIds = draft.acceptedLegalDocumentIds.filter((documentId) => documentId !== legalDocument.id)
                    onDraftChange(
                      { acceptedLegalDocumentIds: event.target.checked ? [...otherIds, legalDocument.id] : otherIds },
                      [legalKey],
                    )
                  }}
                />
              )
            })}
          </div>
        )}
      </section>

      {/* ─── Notes ─── */}
      <section>
        <TextareaField
          id={`${idPrefix}-notes`}
          label={t("notes")}
          rows={4}
          value={draft.notes}
          disabled={readOnly}
          error={errors.notes}
          hint={isLow("notes") ? t("notesLowConfidence") : t("notesHint")}
          onChange={(event) => onDraftChange({ notes: event.target.value }, ["notes"])}
        />
      </section>
    </div>
  )
}
