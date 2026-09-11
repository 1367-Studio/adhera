"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"

type ShippingData = {
  shippingAddress:       string | null
  shippingCity:          string | null
  shippingPostalCode:    string | null
  shippingCountry:       string | null
  shippingMarkupPercent: number
}

interface ShippingSettingsProps {
  canEdit: boolean
}

export function ShippingSettings({ canEdit }: ShippingSettingsProps) {
  const t       = useTranslations("boutiqueShipping")
  const tCommon = useTranslations("common")
  const qc = useQueryClient()

  const { data } = useQuery<ShippingData>({
    queryKey: ["association-shipping"],
    queryFn:  () => fetch("/api/association/shipping").then(r => r.json()),
  })

  const [address, setAddress]         = useState("")
  const [city, setCity]               = useState("")
  const [postalCode, setPostalCode]   = useState("")
  const [country, setCountry]         = useState("FR")
  // Kept as the raw typed string, not a number — a controlled number input whose value is
  // round-tripped through Number() on every keystroke can't hold an in-progress decimal
  // ("12." parses to 12, so React re-renders the field back to "12" and silently eats the
  // dot the user just typed, corrupting whatever they type next). The string form always
  // reflects exactly what was typed; only markupValue below turns it into a number.
  const [markupInput, setMarkupInput] = useState("0")
  const [dirty, setDirty]             = useState(false)

  const markupValue = markupInput.trim() === "" ? NaN : Number(markupInput)
  const markupError = !Number.isInteger(markupValue) || markupValue < 0 || markupValue > 50
    ? t("markupRangeError")
    : undefined

  useEffect(() => {
    if (!data) return
    setAddress(data.shippingAddress ?? "")
    setCity(data.shippingCity ?? "")
    setPostalCode(data.shippingPostalCode ?? "")
    setCountry(data.shippingCountry ?? "FR")
    setMarkupInput(String(data.shippingMarkupPercent ?? 0))
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/shipping", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          shippingAddress:       address,
          shippingCity:          city,
          shippingPostalCode:    postalCode,
          shippingCountry:       country,
          shippingMarkupPercent: markupValue,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        // On a zod failure `d.error` is an array of issues, not a string (see the PATCH
        // route) — stringifying that directly would show "[object Object]" in the toast.
        throw new Error(typeof d.error === "string" ? d.error : tCommon("error"))
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["association-shipping"] })
      toast.success(t("saved"))
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("description")}</p>
      </div>

      <div className="space-y-3">
        <FormField
          label={t("addressLabel")}
          placeholder={t("addressPlaceholder")}
          disabled={!canEdit}
          value={address}
          onChange={e => { setAddress(e.target.value); setDirty(true) }}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label={t("postalCodeLabel")}
            disabled={!canEdit}
            value={postalCode}
            onChange={e => { setPostalCode(e.target.value); setDirty(true) }}
          />
          <FormField
            label={t("cityLabel")}
            disabled={!canEdit}
            value={city}
            onChange={e => { setCity(e.target.value); setDirty(true) }}
          />
        </div>
        <FormField
          label={t("countryLabel")}
          disabled={!canEdit}
          maxLength={2}
          value={country}
          onChange={e => { setCountry(e.target.value.toUpperCase()); setDirty(true) }}
        />
        <FormField
          label={`${t("markupLabel")} (%)`}
          hint={markupError ? undefined : t("markupHint")}
          hintTooltip={t("markupHintTooltip")}
          error={markupError}
          type="number"
          min={0}
          max={50}
          disabled={!canEdit}
          value={markupInput}
          // Kept unclamped while typing — silently snapping 75 down to 50 mid-keystroke
          // reads as the field ignoring input. The error message + disabled Save below
          // are what actually enforce the 0-50 range.
          onChange={e => { setMarkupInput(e.target.value); setDirty(true) }}
          // Native number inputs change value on mouse wheel when focused — a real risk
          // here since this field sits mid-page in a scrollable settings form. Blurring
          // on wheel turns that scroll back into an ordinary page scroll.
          onWheel={e => e.currentTarget.blur()}
        />
      </div>

      {canEdit && (
        <Button
          size="sm"
          disabled={!dirty || !!markupError}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {tCommon("save")}
        </Button>
      )}
    </div>
  )
}
