"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PaperPlaneTiltIcon, WarningIcon, UsersIcon, TagIcon, UserCheckIcon, MagnifyingGlassIcon, CheckIcon, PencilSimpleIcon, CaretRightIcon, CircleNotchIcon, DeviceMobileIcon, InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useQuery } from "@tanstack/react-query"
import { registerPendingBulkSend } from "@/hooks/use-bulk-send-listener"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

type MembreTypeRef = { id: string; name: string; color: string }

type MembrePick = {
  id:        string
  firstName: string
  lastName:  string
  phone:     string | null
  typeId:    string | null
  type:      MembreTypeRef | null
}

type RecipientMode = "all" | "type" | "manual"

// ── SMS char counter ───────────────────────────────────────────────────────────

function SmsCounter({ text }: { text: string }) {
  const t = useTranslations()
  const len = text.length
  // Multi-segment SMS uses 153 chars/segment (7 bytes reserved for UDH concat header)
  const segments  = len === 0 ? 1 : len <= 160 ? 1 : Math.ceil(len / 153)
  const remaining = len <= 160 ? 160 - len : 153 - (len % 153 || 153)

  return (
    <p className={cn(
      "text-xs text-right mt-1",
      remaining < 20 ? "text-amber-500" : "text-muted-foreground",
    )}>
      {t("membres.sms.charsRemaining", { count: remaining })}
      {segments > 1 && <span className="ml-2 text-amber-500">{t("membres.sms.segmentsCount", { count: segments })}</span>}
    </p>
  )
}

// ── Member pick list ───────────────────────────────────────────────────────────

function MemberPickList({
  membres,
  selectedIds,
  onToggle,
  truncated,
}: {
  membres:     MembrePick[]
  selectedIds: string[]
  onToggle:    (id: string) => void
  truncated:   boolean
}) {
  const t = useTranslations()
  const [search, setSearch] = useState("")

  const filtered = search.trim()
    ? membres.filter(m =>
        `${m.lastName} ${m.firstName}`.toLowerCase().includes(search.toLowerCase()) ||
        (m.phone ?? "").includes(search)
      )
    : membres

  const allFilteredSelected = filtered.length > 0 && filtered.every(m => selectedIds.includes(m.id))

  function toggleFiltered() {
    if (allFilteredSelected) {
      filtered.forEach(m => { if (selectedIds.includes(m.id))  onToggle(m.id) })
    } else {
      filtered.forEach(m => { if (!selectedIds.includes(m.id)) onToggle(m.id) })
    }
  }

  return (
    <div className="space-y-2">
      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
          <span>{t("membres.sms.truncatedNotice")}</span>
        </div>
      )}
      <div className="rounded-lg border overflow-hidden">
        <div className="p-2 border-b bg-muted/30 space-y-2">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder={t("membres.sms.searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center justify-between px-0.5">
            <span className="text-xs text-muted-foreground">{t("membres.sms.membersCount", { count: filtered.length })}</span>
            <button type="button" onClick={toggleFiltered} className="text-xs text-primary hover:underline">
              {allFilteredSelected ? t("membres.sms.deselectAll") : t("membres.sms.selectAll")}
            </button>
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto divide-y">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-6">{t("membres.sms.noMemberFound")}</p>
          ) : (
            filtered.map(m => {
              const isSelected = selectedIds.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onToggle(m.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors",
                    isSelected ? "bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <span className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected ? "bg-primary border-primary text-primary-foreground" : "border-input",
                  )}>
                    {isSelected && <CheckIcon className="size-2.5" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{m.lastName} {m.firstName}</span>
                    {m.phone && <span className="text-xs text-muted-foreground truncate block">{m.phone}</span>}
                  </span>
                  {m.type && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ background: `${m.type.color}20`, color: m.type.color }}>
                      {m.type.name}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
        <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          {selectedIds.length > 0
            ? t("membres.sms.selectedCount", { count: selectedIds.length })
            : t("membres.sms.noMemberSelected")}
        </div>
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface SendSmsModalProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export function SendSmsModal({ open, onOpenChange }: SendSmsModalProps) {
  const t = useTranslations()
  const [step,              setStep]              = useState<"compose" | "confirm">("compose")
  const [recipientMode,     setRecipientMode]     = useState<RecipientMode>("all")
  const [selectedTypeId,    setSelectedTypeId]    = useState<string>("")
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [body,              setBody]              = useState("")
  const [sending,           setSending]           = useState(false)
  const [countLoading,      setCountLoading]      = useState(false)
  const [recipientCount,    setRecipientCount]    = useState<number | null>(null)
  const [closeWarningOpen,  setCloseWarningOpen]  = useState(false)

  useEffect(() => {
    if (!open) {
      setStep("compose")
      setRecipientMode("all")
      setSelectedTypeId("")
      setSelectedMemberIds([])
      setBody("")
      setSending(false)
      setCountLoading(false)
      setRecipientCount(null)
      setCloseWarningOpen(false)
    }
  }, [open])

  useEffect(() => { setRecipientCount(null) }, [recipientMode, selectedTypeId])

  const { data: types = [] } = useQuery<MembreTypeRef[]>({
    queryKey: ["membre-types"],
    queryFn:  () => fetch("/api/membre-types").then(r => r.json()),
    enabled:  open,
  })

  const { data: allMembres = [], isLoading: loadingMembres } = useQuery<MembrePick[]>({
    queryKey:  ["membres-sms-pick"],
    queryFn:   () => fetch("/api/membres?status=ACTIF").then(r => r.json()),
    enabled:   open && recipientMode === "manual",
    staleTime: 30_000,
  })
  const membresWithPhone = allMembres.filter(m => m.phone)
  const listTruncated    = allMembres.length >= 500

  const selectedType     = types.find(type => type.id === selectedTypeId)
  const selectedTypeName = selectedType?.name ?? ""

  async function handleContinue() {
    if (recipientMode === "type" && !selectedTypeId) {
      toast.error(t("membres.sms.toasts.selectType"))
      return
    }
    if (recipientMode === "manual" && selectedMemberIds.length === 0) {
      toast.error(t("membres.sms.toasts.selectMember"))
      return
    }
    if (!body.trim()) {
      toast.error(t("membres.sms.toasts.writeMessage"))
      return
    }

    if (recipientMode === "manual") {
      setRecipientCount(selectedMemberIds.length)
      setStep("confirm")
      return
    }

    setCountLoading(true)
    try {
      const qs  = recipientMode === "type" ? `?typeId=${selectedTypeId}` : ""
      const res = await fetch(`/api/membres/sms/count${qs}`)
      const d   = await res.json()
      const count = d.count ?? 0

      if (count === 0) {
        toast.error(t("membres.sms.toasts.noPhoneRecipient"))
        return
      }

      setRecipientCount(count)
      setStep("confirm")
    } catch {
      toast.error(t("membres.sms.toasts.cannotVerifyCount"))
    } finally {
      setCountLoading(false)
    }
  }

  async function handleSend() {
    setSending(true)
    try {
      const payload: Record<string, unknown> = { body }
      if (recipientMode === "manual")                 payload.recipientIds = selectedMemberIds
      if (recipientMode === "type" && selectedTypeId) payload.typeId       = selectedTypeId

      const res  = await fetch("/api/membres/sms", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("common.error")); return }

      // The actual send now runs in the background (Inngest) — this response just confirms
      // it was queued. registerPendingBulkSend + useBulkSendListener (mounted in AppSidebar)
      // deliver the real sent/failed toast once the send finishes, even if this modal has
      // long since closed.
      registerPendingBulkSend(data.jobId)
      toast.info(t("membres.sms.toasts.queued", { count: data.totalRecipients }))
      onOpenChange(false)
    } catch {
      toast.error(t("membres.sms.toasts.networkError"))
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    if (sending) return
    if (body.trim()) { setCloseWarningOpen(true); return }
    onOpenChange(false)
  }

  const recipientSummary =
    recipientMode === "manual"
      ? t("membres.sms.selectedCount", { count: selectedMemberIds.length })
      : recipientMode === "type" && selectedTypeId
        ? selectedTypeName
          ? t("membres.sms.recipientsOfType", { count: recipientCount ?? 0, type: selectedTypeName })
          : t("membres.sms.recipientsTypeSelected", { count: recipientCount ?? 0 })
        : t("membres.sms.recipientsActive", { count: recipientCount ?? 0 })

  return (
    <>
      <Modal
        open={open}
        onOpenChange={handleClose}
        title={t("membres.sms.title")}
        size="md"
        dismissable={!sending}
      >
        {step === "compose" ? (
          <div className="space-y-5">

            {/* ── Recipients ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("membres.sms.recipients")}</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { mode: "all",    icon: UsersIcon,     label: t("membres.sms.modeAll") },
                  { mode: "type",   icon: TagIcon,       label: t("membres.sms.modeType") },
                  { mode: "manual", icon: UserCheckIcon, label: t("membres.sms.modeManual") },
                ] as const).map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRecipientMode(mode)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all",
                      recipientMode === mode
                        ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>

              {recipientMode === "all" && (
                <p className="text-xs text-muted-foreground">
                  {t("membres.sms.allModeNotice")}
                </p>
              )}

              {recipientMode === "type" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t("membres.sms.typeLabel")} <span className="text-red-500">*</span></p>
                  {types.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">{t("membres.sms.noTypeConfigured")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {types.map(type => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => setSelectedTypeId(type.id === selectedTypeId ? "" : type.id)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                            selectedTypeId === type.id
                              ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                              : "border-border text-muted-foreground hover:border-muted-foreground/40",
                          )}
                        >
                          <span className="size-2 rounded-full shrink-0" style={{ background: type.color }} />
                          {type.name}
                          {selectedTypeId === type.id && <CheckIcon className="size-3 ml-0.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {recipientMode === "manual" && (
                loadingMembres ? (
                  <div className="h-40 rounded-lg bg-muted animate-pulse" />
                ) : membresWithPhone.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    {t("membres.sms.noActiveMemberWithPhone")}
                  </p>
                ) : (
                  <MemberPickList
                    membres={membresWithPhone}
                    selectedIds={selectedMemberIds}
                    truncated={listTruncated}
                    onToggle={id => setSelectedMemberIds(prev =>
                      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                    )}
                  />
                )
              )}
            </div>

            <div className="border-t" />

            {/* ── Message ── */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("membres.sms.message")}</p>
              <textarea
                rows={5}
                maxLength={1600}
                placeholder={t("membres.sms.messagePlaceholder")}
                value={body}
                onChange={e => setBody(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <SmsCounter text={body} />
              <div className="flex items-start gap-2 rounded-lg border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <DeviceMobileIcon className="size-3.5 shrink-0 mt-0.5" />
                <span>{t("membres.sms.variablesNotice", { p: "{{prenom}}", a: "{{association}}" })}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose}>{t("common.cancel")}</Button>
              <Button onClick={handleContinue} disabled={countLoading}>
                {countLoading
                  ? <CircleNotchIcon className="mr-1.5 size-4 animate-spin" />
                  : <CaretRightIcon className="mr-1.5 size-4" />
                }
                {t("membres.sms.continue")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex gap-3">
              <WarningIcon className="size-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t("membres.sms.confirmSendTitle")}</p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {t("membres.sms.confirmSendDescription", { recipients: recipientSummary })}
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">{t("membres.sms.message")}</p>
                <p className="text-sm whitespace-pre-wrap">{body}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">{t("membres.sms.recipients")}</p>
                <p className="text-sm font-medium">{recipientSummary}</p>
                {recipientMode === "manual" && (
                  <p className="text-xs text-muted-foreground">{t("membres.sms.recipientsManualOnly")}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("compose")} disabled={sending}>
                <PencilSimpleIcon className="mr-1.5 size-3.5" />
                {t("common.edit")}
              </Button>
              <Button onClick={handleSend} loading={sending}>
                <PaperPlaneTiltIcon className="mr-1.5 size-4" />
                {t("membres.sms.sendNow")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={closeWarningOpen}
        onOpenChange={setCloseWarningOpen}
        title={t("membres.sms.discardTitle")}
        description={t("membres.sms.discardDescription")}
        confirmLabel={t("membres.sms.discard")}
        onConfirm={() => { setCloseWarningOpen(false); onOpenChange(false) }}
      />
    </>
  )
}
