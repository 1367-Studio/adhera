"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"

type ShippingData = {
  shippingAddress:    string | null
  shippingCity:       string | null
  shippingPostalCode: string | null
  shippingCountry:    string | null
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

  const [address, setAddress]       = useState("")
  const [city, setCity]             = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [country, setCountry]       = useState("FR")
  const [dirty, setDirty]           = useState(false)

  useEffect(() => {
    if (!data) return
    setAddress(data.shippingAddress ?? "")
    setCity(data.shippingCity ?? "")
    setPostalCode(data.shippingPostalCode ?? "")
    setCountry(data.shippingCountry ?? "FR")
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/shipping", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          shippingAddress:    address,
          shippingCity:       city,
          shippingPostalCode: postalCode,
          shippingCountry:    country,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? tCommon("error"))
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
      </div>

      {canEdit && (
        <Button
          size="sm"
          disabled={!dirty}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {tCommon("save")}
        </Button>
      )}
    </div>
  )
}
