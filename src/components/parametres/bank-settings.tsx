"use client"

import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"

type BankData = {
  website: string | null
  iban:    string | null
  bic:     string | null
}

interface BankSettingsProps {
  canEdit: boolean
  data:    BankData
}

export function BankSettings({ canEdit, data }: BankSettingsProps) {
  const t = useTranslations("parametres.bankSettings")
  const tCommon = useTranslations("common")
  const qc = useQueryClient()

  const [website, setWebsite] = useState(data.website ?? "")
  const [iban, setIban]       = useState(data.iban ?? "")
  const [bic, setBic]         = useState(data.bic ?? "")
  const [dirty, setDirty]     = useState(false)

  useEffect(() => {
    setWebsite(data.website ?? "")
    setIban(data.iban ?? "")
    setBic(data.bic ?? "")
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/bank", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ website, iban, bic }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<BankData>
    },
    onSuccess: (saved) => {
      setWebsite(saved.website ?? "")
      setIban(saved.iban ?? "")
      setBic(saved.bic ?? "")
      qc.invalidateQueries({ queryKey: ["association"] })
      toast.success(t("toasts.updated"))
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const hasPreview = !!(website || iban || bic)

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("subtitle")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("website")}</Label>
          <Input
            disabled={!canEdit}
            value={website}
            onChange={e => { setWebsite(e.target.value); setDirty(true) }}
            placeholder={t("websitePlaceholder")}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("iban")}</Label>
            <Input
              disabled={!canEdit}
              value={iban}
              onChange={e => { setIban(e.target.value); setDirty(true) }}
              placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("bic")}</Label>
            <Input
              disabled={!canEdit}
              value={bic}
              onChange={e => { setBic(e.target.value); setDirty(true) }}
              placeholder="AGRIFRPP"
              className="font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {hasPreview && (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
          <p className="font-medium text-muted-foreground">{t("previewTitle")}</p>
          {website && <p className="text-muted-foreground">{website}</p>}
          {(iban || bic) && (
            <div className="pt-1 space-y-0.5">
              <p className="font-medium">{t("bankDetails")}</p>
              {iban && <p className="text-muted-foreground">{t("ibanColon", { value: iban })}</p>}
              {bic  && <p className="text-muted-foreground">{t("bicColon", { value: bic })}</p>}
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <Button size="sm" disabled={!dirty} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {tCommon("save")}
        </Button>
      )}
    </div>
  )
}
