import type { useTranslations } from "next-intl"
import type { PaperFormTarget } from "@/lib/paper-form-targets"

type Translator = ReturnType<typeof useTranslations>

// How the template editor groups the targets in its select. Every PaperFormTarget appears in
// exactly one group — the `satisfies` below fails the build when a target is added to
// PAPER_FORM_TARGETS without being placed here.
const PAPER_FORM_TARGET_GROUPS = [
  { groupKey: "identity",    targets: ["fullName", "firstName", "lastName", "birthDate", "civilite", "sexe"] },
  { groupKey: "contact",     targets: ["email", "phone", "address"] },
  { groupKey: "guardian",    targets: ["guardianFullName", "guardianPhone", "secondGuardianFullName", "secondGuardianPhone"] },
  { groupKey: "commitments", targets: ["imageRights", "legalDocument"] },
  { groupKey: "other",       targets: ["notes", "ignore"] },
] as const satisfies readonly { groupKey: string; targets: readonly PaperFormTarget[] }[]

type GroupedTarget = (typeof PAPER_FORM_TARGET_GROUPS)[number]["targets"][number]
// Compile-time check: a target missing from the groups makes this type `never`-incompatible.
const everyTargetIsGrouped: Record<Exclude<PaperFormTarget, GroupedTarget>, never> = {}
void everyTargetIsGrouped

export type PaperFormTargetGroup = {
  label:   string
  options: { value: PaperFormTarget; label: string }[]
}

// Shared with the scan review screen, so a target reads the same on both.
export function getPaperFormTargetLabel(t: Translator, target: PaperFormTarget): string {
  return t(`paperFormTemplates.targets.${target}`)
}

export function getPaperFormTargetGroups(t: Translator): PaperFormTargetGroup[] {
  return PAPER_FORM_TARGET_GROUPS.map((targetGroup) => ({
    label:   t(`paperFormTemplates.targetGroups.${targetGroup.groupKey}`),
    options: targetGroup.targets.map((target) => ({ value: target, label: getPaperFormTargetLabel(t, target) })),
  }))
}
