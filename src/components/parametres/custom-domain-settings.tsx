"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

type DnsRecord = { type: string; domain: string; value: string }
type CustomDomainData = {
  customDomain:           string | null
  customDomainStatus:     "PENDING" | "VERIFIED" | "FAILED" | null
  customDomainDnsRecords: DnsRecord[] | { error?: { message?: string } } | null
}

// A subdomain (www.assoc.fr) resolves with one CNAME; an apex domain (assoc.fr) needs an A
// record instead — the exact record the admin must add always comes straight from the
// Vercel Domains API response (cached in customDomainDnsRecords), never computed locally,
// so this component only has to render whatever came back, not decide the DNS type itself.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

export function CustomDomainSettings({ canEdit }: { canEdit: boolean }) {
  const t       = useTranslations("parametres.customDomainSettings")
  const tCommon = useTranslations("common")
  const qc = useQueryClient()

  const { data } = useQuery<CustomDomainData>({
    queryKey: ["association-custom-domain"],
    queryFn:  () => fetch("/api/association/custom-domain").then(r => r.json()),
  })

  const [domainInput, setDomainInput] = useState("")
  const [removeOpen, setRemoveOpen]   = useState(false)

  const domainTrimmed = domainInput.trim().toLowerCase()
  const domainError = domainTrimmed !== "" && !DOMAIN_PATTERN.test(domainTrimmed) ? t("invalidDomain") : undefined

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/custom-domain", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ domain: domainTrimmed }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(typeof d.error === "string" ? d.error : tCommon("error"))
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["association-custom-domain"] })
      toast.success(t("saved"))
      setDomainInput("")
    },
    onError: err => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/custom-domain/verify", { method: "POST" })
      if (!res.ok) throw new Error(tCommon("error"))
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["association-custom-domain"] }),
    onError:   () => toast.error(tCommon("error")),
  })

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/custom-domain", { method: "DELETE" })
      if (!res.ok) throw new Error(tCommon("error"))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["association-custom-domain"] })
      toast.success(t("removed"))
      setRemoveOpen(false)
    },
    onError: () => toast.error(tCommon("error")),
  })

  if (!data) return null

  const status  = data.customDomainStatus
  const records = Array.isArray(data.customDomainDnsRecords) ? data.customDomainDnsRecords : null
  const errorMessage = !Array.isArray(data.customDomainDnsRecords) && data.customDomainDnsRecords
    ? data.customDomainDnsRecords.error?.message
    : undefined

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("subtitle")}</p>
      </div>

      {!data.customDomain ? (
        <div className="space-y-3">
          <FormField
            label={t("domainLabel")}
            placeholder={t("domainPlaceholder")}
            hint={t("domainHint")}
            error={domainError}
            disabled={!canEdit}
            value={domainInput}
            onChange={e => setDomainInput(e.target.value)}
          />
          {canEdit && (
            <Button
              size="sm"
              disabled={!domainTrimmed || !!domainError}
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {tCommon("save")}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{data.customDomain}</span>
            <span className={cn(
              "text-xs",
              status === "VERIFIED" ? "text-emerald-600" : status === "FAILED" ? "text-destructive" : "text-muted-foreground",
            )}>
              {status === "VERIFIED" ? t("statusVerified") : status === "FAILED" ? (errorMessage ?? t("statusFailed")) : t("statusPending")}
            </span>
          </div>

          {status !== "VERIFIED" && records && records.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("dnsInstruction")}</p>
              <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs space-y-1">
                {records.map((record, index) => (
                  <div key={index}>{record.type} {record.domain} → {record.value}</div>
                ))}
              </div>
            </div>
          )}

          {status === "PENDING" && <p className="text-xs text-muted-foreground">{t("waitingHint")}</p>}

          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" loading={verifyMutation.isPending} onClick={() => verifyMutation.mutate()}>
                {t("verifyNow")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRemoveOpen(true)}>
                {t("remove")}
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t("removeConfirmTitle")}
        description={t("removeConfirmDescription")}
        confirmLabel={tCommon("delete")}
        loading={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate()}
      />
    </div>
  )
}
