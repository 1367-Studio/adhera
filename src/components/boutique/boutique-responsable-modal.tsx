"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { SelectField } from "@/components/ui/select-field"

type Settings = { responsableId: string | null; users: { id: string; name: string; email: string }[] }

export function BoutiqueResponsableModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t       = useTranslations("boutique")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()
  const [responsableId, setResponsableId] = useState("")

  const { data: settings } = useQuery<Settings>({
    queryKey: ["boutique-settings"],
    queryFn:  () => fetch("/api/boutique/settings").then(r => r.json()),
    enabled:  open,
  })

  useEffect(() => { if (settings) setResponsableId(settings.responsableId ?? "") }, [settings])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/boutique/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsableId: responsableId || null }),
      })
      if (!res.ok) throw new Error(tCommon("error"))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boutique-settings"] })
      toast.success(tCommon("saved"))
      onOpenChange(false)
    },
    onError: () => toast.error(tCommon("error")),
  })

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("responsableModal.title")}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
          <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{tCommon("save")}</Button>
        </>
      }
    >
      <div className="py-1 space-y-2">
        <SelectField
          label={t("responsableModal.selectLabel")}
          placeholder={t("responsableModal.none")}
          value={responsableId}
          onValueChange={setResponsableId}
          options={[
            { value: "", label: t("responsableModal.none") },
            ...(settings?.users ?? []).map(u => ({ value: u.id, label: `${u.name} — ${u.email}` })),
          ]}
        />
        <p className="text-xs text-muted-foreground">{t("responsableModal.hint")}</p>
      </div>
    </Modal>
  )
}
