"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { InfoIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { ColorField } from "@/components/ui/color-field"
import { Label } from "@/components/ui/label"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { MemberCard } from "@/components/member-card/member-card"
import { useMemberCardSettings, useUpdateMemberCardSettings } from "@/hooks/use-member-card-settings"
import { DEFAULT_MEMBER_CARD_COLOR, isColorTooLightOnWhite } from "@/lib/member-card/color"
import {
  DEFAULT_MEMBER_CARD_SETTINGS,
  MEMBER_CARD_COLOR_PATTERN,
  MEMBER_CARD_TEMPLATES,
  type MemberCardSettings as MemberCardSettingsValue,
  type MemberCardTemplate,
} from "@/lib/member-card/settings"
import { memberCardVerificationUrl } from "@/lib/member-card/url"
import {
  buildMemberCardInitials,
  formatMemberCardContact,
  type MemberCardViewModel,
} from "@/lib/member-card/view-model"

interface MemberCardSettingsProps {
  canEdit: boolean
  /** Shown on the preview card, so an admin judges the layout with their own name in it. */
  associationName: string
  /** Already resolved through the plan's branding — null means "no logo on the card". */
  logoUrl: string | null
  /**
   * The association's real contact details, so the preview shows what the card would actually
   * print — including the truncation of a long e-mail, and the empty result of switching a
   * setting on for a field that was never filled in. null means "not filled in".
   */
  associationPhone:        string | null
  associationContactEmail: string | null
}

export function MemberCardSettings({
  canEdit,
  associationName,
  logoUrl,
  associationPhone,
  associationContactEmail,
}: MemberCardSettingsProps) {
  const t       = useTranslations("memberCard.settings")
  const tCommon = useTranslations("common")

  const { data: savedSettings } = useMemberCardSettings()
  const updateMutation          = useUpdateMemberCardSettings()

  const [draftSettings, setDraftSettings] = useState<MemberCardSettingsValue>(DEFAULT_MEMBER_CARD_SETTINGS)
  // The hex *as typed*, kept apart from draftSettings.color (which only ever holds a valid
  // "#RRGGBB" or null): mid-typing states like "#02" and a cleared field must not travel to
  // the API, where the strict schema would answer 422 for a perfectly normal edit.
  const [colorInput, setColorInput]       = useState(DEFAULT_MEMBER_CARD_COLOR)
  const [dirty, setDirty]                 = useState(false)

  useEffect(() => {
    // Same guard as cotisation-defaults-settings: a background refetch must not wipe an edit
    // in progress (and with it the dirty flag that gates the save button).
    if (!savedSettings || dirty) return
    setDraftSettings(savedSettings)
    setColorInput(savedSettings.color ?? DEFAULT_MEMBER_CARD_COLOR)
  }, [savedSettings, dirty])

  function updateDraft(patch: Partial<MemberCardSettingsValue>) {
    setDraftSettings(current => ({ ...current, ...patch }))
    setDirty(true)
  }

  // An unfinished or emptied hex reads as "no colour chosen", which is exactly what null
  // means in the stored settings — the card then falls back to the platform colour.
  function handleColorChange(typedColor: string) {
    setColorInput(typedColor)
    const trimmedColor = typedColor.trim()
    updateDraft({ color: MEMBER_CARD_COLOR_PATTERN.test(trimmedColor) ? trimmedColor : null })
  }

  function handleSave() {
    updateMutation.mutate(draftSettings, {
      onSuccess: () => { setDirty(false); toast.success(t("saved")) },
      onError:   (error) => toast.error(error instanceof Error ? error.message : tCommon("error")),
    })
  }

  const usesColor       = draftSettings.template !== "minimal"
  const colorTooLight   = usesColor && isColorTooLightOnWhite(draftSettings.color ?? DEFAULT_MEMBER_CARD_COLOR)
  const templateOptions = MEMBER_CARD_TEMPLATES.map(template => ({
    value: template,
    label: t(`templates.${template}`),
  }))

  // A fixed year ahead of *this* render, not of every render: a date that moves on each
  // keystroke would make the preview flicker and re-encode the QR for nothing.
  const previewValidUntil = useMemo(() => {
    const oneYearOut = new Date()
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1)
    return oneYearOut
  }, [])

  const sampleName       = t("sampleName")
  const [sampleFirstName = "", sampleLastName = ""] = sampleName.split(" ")
  const previewCard: MemberCardViewModel = {
    associationName,
    logoUrl,
    memberName:  sampleName,
    category:    t("sampleCategory"),
    validUntil:  previewValidUntil,
    state:       "valid",
    // No photo on the sample: the initials are the case an admin cannot preview otherwise,
    // since most of their members have none either.
    photoUrl:    null,
    initials:    buildMemberCardInitials(sampleFirstName, sampleLastName),
    // Gated exactly like the loader gates it, on the *draft* settings: the preview has to show
    // the real numbers, otherwise an admin only discovers a truncated e-mail — or an empty
    // line where an unfilled field was — once the card has been printed.
    contactLine: formatMemberCardContact(
      draftSettings.showPhone ? associationPhone        : null,
      draftSettings.showEmail ? associationContactEmail : null,
    ),
    // The real verification URL with a stand-in token: built through the same helper the
    // printed cards use, so the preview's QR has the density of a real one rather than that
    // of a much shorter made-up string. Never scanned in earnest — "apercu" resolves to no
    // member, and the real token is minted per member at render time.
    verificationUrl: memberCardVerificationUrl("apercu"),
    settings:    draftSettings,
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</p>
      </div>

      <CheckboxField
        id="member-card-enabled"
        label={t("enabled")}
        description={t("enabledHint")}
        checked={draftSettings.enabled}
        disabled={!canEdit}
        onChange={event => updateDraft({ enabled: event.target.checked })}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* On a phone the preview comes first: the options only make sense once you have seen
            what they change. On a wide screen it moves to the right and follows the scroll. */}
        <div className="order-first space-y-2 lg:order-last lg:sticky lg:top-6 lg:self-start">
          <p className="text-xs font-medium text-muted-foreground">{t("preview")}</p>
          <MemberCard card={previewCard} className="max-w-md" />
          {!logoUrl && <p className="text-xs text-muted-foreground">{t("noLogo")}</p>}
        </div>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("template")}</Label>
            <SegmentedControl<MemberCardTemplate>
              options={templateOptions}
              value={draftSettings.template}
              onChange={template => updateDraft({ template })}
              disabled={!canEdit}
              // Default size, not `sm`: it lands on exactly 36px, the same height as the
              // colour field right below it (CLAUDE.md §3).
              className="w-full"
            />
          </div>

          {usesColor ? (
            <div className="space-y-1.5">
              <ColorField
                label={t("color")}
                value={colorInput}
                onChange={handleColorChange}
                fallbackColor={DEFAULT_MEMBER_CARD_COLOR}
                placeholder={DEFAULT_MEMBER_CARD_COLOR}
                disabled={!canEdit}
              />
              {/* A warning, not a block: a pale brand colour is still the association's. */}
              {colorTooLight && (
                <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
                  <span>{t("colorTooLight")}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("minimalNoColor")}</p>
          )}

          <div className="space-y-2">
            <Label className="text-xs">{t("showOnCard")}</Label>
            <CheckboxField
              id="member-card-show-photo"
              label={t("showPhoto")}
              hint={t("showPhotoHint")}
              checked={draftSettings.showPhoto}
              disabled={!canEdit}
              onChange={event => updateDraft({ showPhoto: event.target.checked })}
            />
            <CheckboxField
              id="member-card-show-category"
              label={t("showCategory")}
              checked={draftSettings.showCategory}
              disabled={!canEdit}
              onChange={event => updateDraft({ showCategory: event.target.checked })}
            />
            {/* The hint only appears when the field is empty, like noLogo above: with the
                number filled in, the preview beside it already says what will be printed. */}
            <CheckboxField
              id="member-card-show-phone"
              label={t("showPhone")}
              hint={associationPhone ? undefined : t("noPhone")}
              checked={draftSettings.showPhone}
              disabled={!canEdit}
              onChange={event => updateDraft({ showPhone: event.target.checked })}
            />
            <CheckboxField
              id="member-card-show-email"
              label={t("showEmail")}
              hint={associationContactEmail ? undefined : t("noEmail")}
              checked={draftSettings.showEmail}
              disabled={!canEdit}
              onChange={event => updateDraft({ showEmail: event.target.checked })}
            />
          </div>
        </div>
      </div>

      {canEdit && (
        <Button size="sm" disabled={!dirty} loading={updateMutation.isPending} onClick={handleSave}>
          {tCommon("save")}
        </Button>
      )}
    </div>
  )
}
