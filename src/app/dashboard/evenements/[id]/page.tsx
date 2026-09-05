"use client"

import { EvenementCustomFieldsEditor, type EvenementCustomFieldsEditorHandle } from "@/components/evenements/evenement-custom-fields-editor"
import { EvenementTicketTypesEditor, type EvenementTicketTypesEditorHandle, type TicketTypeDraftRow } from "@/components/evenements/evenement-ticket-types-editor"
import { EvenementDiscountCodesEditor, type EvenementDiscountCodesEditorHandle } from "@/components/evenements/evenement-discount-codes-editor"
import { EvenementProductsEditor, type EvenementProductsEditorHandle } from "@/components/evenements/evenement-products-editor"
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion"
import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CurrencyField } from "@/components/ui/currency-field"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DocumentUpload } from "@/components/ui/document-upload"
import { FormField } from "@/components/ui/form-field"
import { ImageUpload } from "@/components/ui/image-upload"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LocationPicker } from "@/components/ui/location-picker"
import { Modal } from "@/components/ui/modal"
import { PageHeader } from "@/components/ui/page-header"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { SelectField } from "@/components/ui/select-field"
import { useParticipations, useEvenementTicketTypes } from "@/hooks/use-evenements"
import { BASE_PATH } from "@/lib/env"
import { cn } from "@/lib/utils"
import { useCurrentUser } from "@/lib/user-context"
import {
  ArchiveIcon,
  CheckIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CopyIcon,
  EyeIcon,
  LinkIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

type EvenementStatus       = "DRAFT" | "PUBLISHED" | "ARCHIVED"
type FieldRequirement      = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type Visibility            = "LINK" | "PRIVATE"

type Evenement = {
  id:     string
  title:  string
  status: EvenementStatus

  description: string | null
  imageUrl:    string | null
  date:        string
  endDate:     string | null
  location:    string | null
  lat:         number | null
  lng:         number | null
  price:       string | null
  capacity:    number | null
  waitlistEnabled: boolean

  fieldPhone:     FieldRequirement
  fieldAddress:   FieldRequirement
  fieldBirthDate: FieldRequirement
  fieldGender:    FieldRequirement
  fieldMobile:    FieldRequirement

  allowCash:              boolean
  allowCheque:            boolean
  allowTransfer:          boolean
  offlineInstructions:    string | null
  confirmationMessage:    string | null
  adminNotificationEmail: string | null

  visibility: Visibility
  opensAt:    string | null
  closesAt:   string | null

  conditions:           string | null
  attachments:          { url: string; filename: string; size: number }[] | null
  requireCguvSignature: boolean
  contactEmail:         string | null
  contactPhone:         string | null
}

// price/capacity diverge from the Evenement (GET response) shape on purpose: the API
// serializes a saved price as a Decimal string and a saved capacity as a number, but the
// PATCH body (evenementUpdateSchema) only ever accepts them as plain numbers (or omitted —
// neither field accepts an explicit null over the wire, see infoPayload()).
type SaveableFields = Partial<Omit<Evenement, "id" | "status" | "price" | "capacity">> & { price?: number; capacity?: number }

// One entry per accordion step below, in display order. Each step has its own Save button,
// so unsaved work is tracked per step — see stepDirty / stepIssue in the component.
const STEP_KEYS = ["info", "tiers", "fields", "products", "payment", "publish"] as const
type StepKey = typeof STEP_KEYS[number]

// A <input type="datetime-local"> value has no timezone — it's read back by `new Date(...)`
// as wall-clock local time (see fromDatetimeLocal below), so reversing that on the way back
// means going through Date and its LOCAL getters, not slicing the stored UTC ISO string
// directly — slicing would silently shift the displayed hour by the browser's UTC offset.
// Same convention as the old evenements-view.tsx's dateToDatetimeLocal.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Empty string, not null — evenementUpdateSchema's date-ish fields accept "" as the
// "cleared" sentinel (z.string().optional().or(z.literal(""))), not null.
function fromDatetimeLocal(value: string): string {
  return value ? new Date(value).toISOString() : ""
}

export default function EvenementDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const qc      = useQueryClient()
  const t       = useTranslations("evenements")
  const tForm   = useTranslations("evenements.form")
  const tSteps  = useTranslations("evenements.detail.steps")
  const tCommon = useTranslations("common")
  const user    = useCurrentUser()

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  // The Tarifs / Formulaire (custom fields) editors own their own drafts, so they report
  // dirtiness up rather than the page trying to read it out of them.
  const [tiersDirty, setTiersDirty]     = useState(false)
  // Le brouillon en direct de l'éditeur de tarifs, pas la liste déjà enregistrée — pour que
  // l'éditeur de codes promotionnels juste en dessous propose immédiatement une tarif tout
  // juste renommée/ajoutée, sans attendre que "Tarifs" soit sauvegardé en premier.
  const [tiersDraft, setTiersDraft]     = useState<TicketTypeDraftRow[]>([])
  const [discountCodesDirty, setDiscountCodesDirty] = useState(false)
  const [fieldsDirty, setFieldsDirty]   = useState(false)
  const [productsDirty, setProductsDirty] = useState(false)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [leaveSaving, setLeaveSaving]   = useState(false)
  const [linkCopied, setLinkCopied]     = useState(false)
  const tiersRef  = useRef<EvenementTicketTypesEditorHandle>(null)
  const discountCodesRef = useRef<EvenementDiscountCodesEditorHandle>(null)
  const fieldsRef = useRef<EvenementCustomFieldsEditorHandle>(null)
  const productsRef = useRef<EvenementProductsEditorHandle>(null)
  // Controlled so a refused publish can expand the steps it is complaining about.
  const [openSteps, setOpenSteps] = useState<StepKey[]>([])
  const [publishAttempted, setPublishAttempted] = useState(false)

  // Step 1 — Informations générales
  const [title, setTitle]             = useState("")
  const [imageUrl, setImageUrl]       = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate]               = useState("")
  const [endDate, setEndDate]         = useState("")
  const [location, setLocation]       = useState("")
  const [lat, setLat]                 = useState<number | undefined>(undefined)
  const [lng, setLng]                 = useState<number | undefined>(undefined)
  const [price, setPrice]             = useState(0)
  const [capacity, setCapacity]       = useState<number | "">("")
  const [waitlistEnabled, setWaitlistEnabled] = useState(false)
  const [conditions, setConditions]         = useState("")
  const [attachments, setAttachments]       = useState<{ url: string; filename: string; size: number }[]>([])
  const [requireCguv, setRequireCguv]       = useState(false)
  // Contact affiché aux visiteurs sur la page publique — distinct de adminNotificationEmail
  // (étape Paiement, ci-dessous), qui est interne et jamais montré.
  const [contactEmail, setContactEmail]     = useState("")
  const [contactPhone, setContactPhone]     = useState("")

  // Same lazy-upload pattern as evenement-form.tsx: picking a file only creates a local
  // blob: preview, the real /api/upload only happens on save.
  const [pendingFile, setPendingFile] = useState<{ blobUrl: string; file: File } | null>(null)
  const [pendingPdf, setPendingPdf]   = useState<{ blobUrl: string; file: File } | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  useEffect(() => {
    if (!pendingFile) return
    return () => URL.revokeObjectURL(pendingFile.blobUrl)
  }, [pendingFile])

  useEffect(() => {
    if (!pendingPdf) return
    return () => URL.revokeObjectURL(pendingPdf.blobUrl)
  }, [pendingPdf])

  // Step 3 — Formulaire : matrice de champs standards
  const [fieldPhone, setFieldPhone]         = useState<FieldRequirement>("OPTIONAL")
  const [fieldAddress, setFieldAddress]     = useState<FieldRequirement>("OPTIONAL")
  const [fieldBirthDate, setFieldBirthDate] = useState<FieldRequirement>("HIDDEN")
  const [fieldGender, setFieldGender]       = useState<FieldRequirement>("HIDDEN")
  const [fieldMobile, setFieldMobile]       = useState<FieldRequirement>("HIDDEN")

  // Step 4 — Paiement
  const [allowCash, setAllowCash]         = useState(false)
  const [allowCheque, setAllowCheque]     = useState(false)
  const [allowTransfer, setAllowTransfer] = useState(false)
  const [offlineInstructions, setOfflineInstructions] = useState("")
  const [confirmationMessage, setConfirmationMessage] = useState("")
  const [adminNotificationEmail, setAdminNotificationEmail] = useState("")

  // Step 5 — Publication
  const [visibility, setVisibility]           = useState<Visibility>("LINK")
  const [opensAt, setOpensAt]                 = useState("")
  const [closesAt, setClosesAt]               = useState("")
  const [scheduleEnabled, setScheduleEnabled] = useState(false)

  const { data: evenement, isLoading, isError } = useQuery<Evenement>({
    queryKey: ["evenements", id],
    queryFn:  () => fetch(`/api/evenements/${id}`).then(r => {
      if (!r.ok) throw new Error("not found")
      return r.json()
    }),
  })

  const { data: participations } = useParticipations(id)
  // Same query the Tarifas step's own editor uses — not embedded on the main Evenement
  // query, since the PATCH response (unlike GET) doesn't include ticketTypes and would
  // otherwise wipe this out of the cache after any other step's save.
  const { data: ticketTypesData } = useEvenementTicketTypes(id)
  const hasTicketTypes = (ticketTypesData?.length ?? 0) > 0

  useEffect(() => {
    if (!evenement) return
    setTitle(evenement.title)
    setImageUrl(evenement.imageUrl ?? "")
    setDescription(evenement.description ?? "")
    setDate(toDatetimeLocal(evenement.date))
    setEndDate(toDatetimeLocal(evenement.endDate))
    setLocation(evenement.location ?? "")
    setLat(evenement.lat ?? undefined)
    setLng(evenement.lng ?? undefined)
    setPrice(evenement.price != null ? Number(evenement.price) : 0)
    setCapacity(evenement.capacity ?? "")
    setWaitlistEnabled(evenement.waitlistEnabled)
    setConditions(evenement.conditions ?? "")
    setAttachments(evenement.attachments ?? [])
    setRequireCguv(evenement.requireCguvSignature)
    setContactEmail(evenement.contactEmail ?? "")
    setContactPhone(evenement.contactPhone ?? "")
    setFieldPhone(evenement.fieldPhone)
    setFieldAddress(evenement.fieldAddress)
    setFieldBirthDate(evenement.fieldBirthDate)
    setFieldGender(evenement.fieldGender)
    setFieldMobile(evenement.fieldMobile)
    setAllowCash(evenement.allowCash)
    setAllowCheque(evenement.allowCheque)
    setAllowTransfer(evenement.allowTransfer)
    setOfflineInstructions(evenement.offlineInstructions ?? "")
    setConfirmationMessage(evenement.confirmationMessage ?? "")
    setAdminNotificationEmail(evenement.adminNotificationEmail ?? "")
    setVisibility(evenement.visibility)
    setOpensAt(toDatetimeLocal(evenement.opensAt))
    setClosesAt(toDatetimeLocal(evenement.closesAt))
    setScheduleEnabled(!!(evenement.opensAt || evenement.closesAt))
  }, [evenement])

  const saveMutation = useMutation({
    mutationFn: async (data: SaveableFields) => {
      const res = await fetch(`/api/evenements/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("detail.toasts.saveError"))
      return res.json() as Promise<Evenement>
    },
    onSuccess: (updated) => {
      qc.setQueryData(["evenements", id], updated)
      qc.invalidateQueries({ queryKey: ["evenements"] })
      toast.success(t("detail.toasts.saved"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("detail.toasts.saveError")),
  })

  async function infoPayload(): Promise<SaveableFields | null> {
    if (!title.trim()) {
      toast.error(t("detail.titleRequired"))
      return null
    }
    if (!date) return null
    let resolvedImageUrl = imageUrl
    if (pendingFile) {
      setUploadingImage(true)
      try {
        const fd = new FormData()
        fd.append("file", pendingFile.file)
        fd.append("prefix", "adhera/evenements")
        const res = await fetch("/api/upload", { method: "POST", body: fd })
        if (!res.ok) { toast.error(t("detail.toasts.saveError")); return null }
        const { url } = (await res.json()) as { url: string }
        resolvedImageUrl = url
      } finally {
        setUploadingImage(false)
      }
    }
    let resolvedAttachments = attachments
    if (pendingPdf) {
      setUploadingImage(true)
      try {
        const fd = new FormData()
        fd.append("file", pendingPdf.file)
        fd.append("prefix", "adhera/evenements")
        const res = await fetch("/api/upload", { method: "POST", body: fd })
        if (!res.ok) { toast.error(t("detail.toasts.saveError")); return null }
        const { url } = (await res.json()) as { url: string }
        resolvedAttachments = [{ url, filename: pendingPdf.file.name, size: pendingPdf.file.size }]
      } finally {
        setUploadingImage(false)
      }
    }
    setPendingFile(null)
    setPendingPdf(null)
    // evenementUpdateSchema's optional string fields accept "" as their "cleared" sentinel,
    // never null — component state is already "" when empty, so these pass through as-is.
    // price/capacity must be real numbers (or omitted — see the SaveableFields comment
    // above): capacity is positive()-only, so an empty field is omitted rather than sent as
    // 0 or null, same pre-existing "can't be cleared back to unlimited from this form"
    // limitation the old modal-based EvenementForm also had.
    return {
      title: title.trim(),
      imageUrl:    resolvedImageUrl,
      description,
      date:        new Date(date).toISOString(),
      endDate:     endDate ? new Date(endDate).toISOString() : "",
      location,
      lat, lng,
      price:    price,
      capacity: capacity === "" ? undefined : capacity,
      waitlistEnabled,
      conditions,
      attachments: resolvedAttachments,
      requireCguvSignature: requireCguv,
      contactEmail, contactPhone,
    }
  }
  const standardFieldsPayload = (): SaveableFields => ({ fieldPhone, fieldAddress, fieldBirthDate, fieldGender, fieldMobile })
  const paymentPayload = (): SaveableFields => ({
    allowCash, allowCheque, allowTransfer,
    offlineInstructions,
    confirmationMessage,
    adminNotificationEmail,
  })
  function publishPayload(): SaveableFields | null {
    if (opensAt && closesAt && opensAt >= closesAt) {
      toast.error(tSteps("publish.datesOrderError"))
      return null
    }
    return {
      visibility,
      opensAt:  fromDatetimeLocal(opensAt),
      closesAt: fromDatetimeLocal(closesAt),
    }
  }

  async function handleSaveInfo() {
    const payload = await infoPayload()
    if (payload) saveMutation.mutate(payload)
  }

  const publishMutation = useMutation({
    mutationFn: async (action: "publish" | "unpublish" | "archive" | "duplicate") => {
      const res = await fetch(`/api/evenements/${id}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? tCommon("error"))
      return res.json() as Promise<Evenement>
    },
    onSuccess: (result, action) => {
      if (action === "duplicate") {
        qc.invalidateQueries({ queryKey: ["evenements"] })
        toast.success(t("view.toasts.duplicated"))
        router.push(`/dashboard/evenements/${result.id}`)
        return
      }
      qc.setQueryData(["evenements", id], result)
      qc.invalidateQueries({ queryKey: ["evenements"] })
      if (action === "publish") setPublishAttempted(false)
      toast.success(t("view.toasts.statusUpdated"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/evenements/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error ?? tCommon("error"))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evenements"] })
      toast.success(t("view.toasts.deleted"))
      router.push("/dashboard/evenements")
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const changed = (edited: unknown[], saved: unknown[]) => JSON.stringify(edited) !== JSON.stringify(saved)
  const standardFieldsDirty = !!evenement && changed(
    [fieldPhone, fieldAddress, fieldBirthDate, fieldGender, fieldMobile],
    [evenement.fieldPhone, evenement.fieldAddress, evenement.fieldBirthDate, evenement.fieldGender, evenement.fieldMobile],
  )
  const stepDirty: Record<StepKey, boolean> = {
    info: !!evenement && (!!pendingFile || !!pendingPdf || changed(
      [title, imageUrl, description, date, endDate, location, lat, lng, price, capacity, waitlistEnabled, conditions, attachments, requireCguv, contactEmail, contactPhone],
      [evenement.title, evenement.imageUrl ?? "", evenement.description ?? "", toDatetimeLocal(evenement.date), toDatetimeLocal(evenement.endDate),
        evenement.location ?? "", evenement.lat, evenement.lng, evenement.price != null ? Number(evenement.price) : 0, evenement.capacity ?? "", evenement.waitlistEnabled,
        evenement.conditions ?? "", evenement.attachments ?? [], evenement.requireCguvSignature, evenement.contactEmail ?? "", evenement.contactPhone ?? ""],
    )),
    tiers: tiersDirty || discountCodesDirty,
    fields: fieldsDirty || standardFieldsDirty,
    products: productsDirty,
    payment: !!evenement && changed(
      [allowCash, allowCheque, allowTransfer, offlineInstructions, confirmationMessage, adminNotificationEmail],
      [evenement.allowCash, evenement.allowCheque, evenement.allowTransfer, evenement.offlineInstructions ?? "", evenement.confirmationMessage ?? "", evenement.adminNotificationEmail ?? ""],
    ),
    publish: !!evenement && changed(
      [visibility, opensAt, closesAt],
      [evenement.visibility, toDatetimeLocal(evenement.opensAt), toDatetimeLocal(evenement.closesAt)],
    ),
  }

  const isDirty = STEP_KEYS.some(k => stepDirty[k])

  // Unlike Adesões, an event with zero tarifs is a perfectly valid free/RSVP event, so
  // publishing is only ever blocked by unsaved work, never by a missing tier.
  const stepIssue = (key: StepKey): "unsaved" | null => stepDirty[key] ? "unsaved" : null

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  if (isLoading) return <DetailLoadingSkeleton />
  if (isError || !evenement) {
    return (
      <DetailNotFound
        message={t("detail.notFound")}
        backHref="/dashboard/evenements"
        backLabel={t("detail.backToList")}
      />
    )
  }

  const STATUS_LABEL   = { DRAFT: t("formStatus.draft"), PUBLISHED: t("formStatus.published"), ARCHIVED: t("formStatus.archived") }
  const STATUS_VARIANT: Record<EvenementStatus, "secondary" | "default" | "outline"> = {
    DRAFT: "secondary", PUBLISHED: "default", ARCHIVED: "outline",
  }
  const canDelete = (participations ?? []).length === 0

  const requirementOptions = [
    { value: "REQUIRED", label: tSteps("fields.requirement.required") },
    { value: "OPTIONAL", label: tSteps("fields.requirement.optional") },
    { value: "HIDDEN",   label: tSteps("fields.requirement.hidden") },
  ]

  // Opens the public page with ?preview=1 — the public GET lets a logged-in manager of this
  // association through the PUBLISHED gate for that flag (src/lib/form-preview.ts), so a
  // draft can be checked before publishing.
  function handlePreview() {
    if (!user.associationSlug || !evenement) return
    window.open(`${BASE_PATH}/${user.associationSlug}/evenements/${evenement.id}?preview=1`, "_blank", "noopener")
  }

  async function handleCopyLink() {
    if (!user.associationSlug || !evenement) return
    const url = `${window.location.origin}${BASE_PATH}/${user.associationSlug}/evenements/${evenement.id}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      toast.success(t("detail.toasts.linkCopied"))
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      toast.error(t("detail.toasts.linkCopyError"))
    }
  }

  const stepTitles: Record<StepKey, string> = {
    info:    tSteps("info.title"),
    tiers:   tSteps("tiers.title"),
    fields:  tSteps("fields.title"),
    products: tSteps("products.title"),
    payment: tSteps("payment.title"),
    publish: tSteps("publish.title"),
  }

  function handlePublish() {
    const blocked = STEP_KEYS.filter(k => stepIssue(k) !== null)
    if (blocked.length === 0) {
      publishMutation.mutate("publish")
      return
    }
    setPublishAttempted(true)
    setOpenSteps(prev => Array.from(new Set([...prev, ...blocked])))
    toast.error(t("detail.publishBlocked.unsavedToast", { steps: blocked.map(k => stepTitles[k]).join(", ") }))
    document.getElementById(`step-${blocked[0]}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // "Enregistrer et quitter" enchaîne plusieurs sauvegardes indépendantes (chaque éditeur a
  // sa propre requête) — si l'une d'elles échoue après que d'autres ont déjà réussi, l'admin
  // ne doit pas croire que RIEN n'a été enregistré : son propre toast d'erreur suffit pour
  // l'étape qui a échoué, mais rien ne dit que les étapes précédentes, elles, sont bien
  // passées. `committedSteps` sert juste à ça.
  async function saveAll(): Promise<boolean> {
    const committedSteps: string[] = []
    const warnPartial = () => { if (committedSteps.length > 0) toast.warning(t("detail.partialSaveWarning")) }

    if (tiersDirty) {
      if (!(await tiersRef.current?.save())) { warnPartial(); return false }
      committedSteps.push("tiers")
    }
    if (discountCodesDirty) {
      if (!(await discountCodesRef.current?.save())) { warnPartial(); return false }
      committedSteps.push("discountCodes")
    }
    if (fieldsDirty) {
      if (!(await fieldsRef.current?.save())) { warnPartial(); return false }
      committedSteps.push("fields")
    }
    if (productsDirty) {
      if (!(await productsRef.current?.save())) { warnPartial(); return false }
      committedSteps.push("products")
    }
    let payload: SaveableFields = {}
    if (stepDirty.info) {
      const info = await infoPayload()
      if (!info) { warnPartial(); return false }
      payload = { ...payload, ...info }
    }
    if (standardFieldsDirty) payload = { ...payload, ...standardFieldsPayload() }
    if (stepDirty.payment)   payload = { ...payload, ...paymentPayload() }
    if (stepDirty.publish) {
      const publish = publishPayload()
      if (!publish) { warnPartial(); return false }
      payload = { ...payload, ...publish }
    }
    if (Object.keys(payload).length === 0) return true
    try {
      await saveMutation.mutateAsync(payload)
      return true
    } catch {
      warnPartial()
      return false
    }
  }

  async function handleSaveAndLeave() {
    setLeaveSaving(true)
    try {
      if (await saveAll()) router.push("/dashboard/evenements")
    } finally {
      setLeaveSaving(false)
    }
  }

  const stepClass = (key: StepKey) =>
    cn(
      "overflow-hidden rounded-lg border bg-card",
      publishAttempted && stepIssue(key) && "bg-destructive/10",
    )
  const stepHeaderClass = (key: StepKey) =>
    publishAttempted && stepIssue(key)
      ? undefined
      : "bg-muted hover:bg-muted/80"
  function stepTrigger(key: StepKey) {
    const issue = publishAttempted ? stepIssue(key) : null
    return (
      <span className="flex items-center gap-2">
        {stepTitles[key]}
        {issue && <span className="text-xs font-normal text-destructive">{t("detail.publishBlocked.unsavedTag")}</span>}
      </span>
    )
  }

  return (
    <div className="space-y-4">
      <BackLink
        href="/dashboard/evenements"
        onClick={e => { if (isDirty) { e.preventDefault(); setLeaveConfirm(true) } }}
      >
        {t("detail.backToList")}
      </BackLink>

      <PageHeader
        title={evenement.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[evenement.status]}>{STATUS_LABEL[evenement.status]}</Badge>
            {evenement.status === "DRAFT" && (
              <span className="text-xs text-muted-foreground">{t("detail.draftNotice")}</span>
            )}
          </span>
        }
        action={
          <div className="flex gap-2">
            {evenement.status !== "PUBLISHED" ? (
              <Button size="sm" onClick={handlePublish} loading={publishMutation.isPending}>
                <CloudArrowUpIcon className="mr-1.5 size-4" />
                {t("detail.publishButton")}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => publishMutation.mutate("unpublish")} loading={publishMutation.isPending}>
                <CloudArrowDownIcon className="mr-1.5 size-4" />
                {t("detail.unpublishButton")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={handlePreview}>
              <EyeIcon className="mr-1.5 size-4" />
              {t("detail.previewButton")}
            </Button>
            {evenement.status === "PUBLISHED" && (
              <Button size="sm" variant="ghost" onClick={handleCopyLink}>
                {linkCopied ? <CheckIcon className="mr-1.5 size-4" /> : <LinkIcon className="mr-1.5 size-4" />}
                {t("detail.copyLinkButton")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => publishMutation.mutate("duplicate")} loading={publishMutation.isPending}>
              <CopyIcon className="mr-1.5 size-4" />
              {t("detail.duplicateButton")}
            </Button>
            {evenement.status !== "ARCHIVED" && (
              <Button size="sm" variant="ghost" onClick={() => publishMutation.mutate("archive")} loading={publishMutation.isPending}>
                <ArchiveIcon className="mr-1.5 size-4" />
                {t("detail.archiveButton")}
              </Button>
            )}
            <Button size="sm" variant="destructive" disabled={!canDelete} onClick={() => setDeleteConfirm(true)}>
              <TrashIcon className="mr-1.5 size-4" />
              {t("detail.deleteButton")}
            </Button>
          </div>
        }
      />

      <Accordion multiple value={openSteps} onValueChange={v => setOpenSteps(v as StepKey[])} keepMounted className="space-y-3 rounded-none border-0 bg-transparent divide-y-0">
        <AccordionItem id="step-info" value="info" className={stepClass("info")}>
          <AccordionTrigger className={stepHeaderClass("info")}>{stepTrigger("info")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-4">
              <div className="max-w-xl space-y-1.5">
                <Label htmlFor="evenement-title">{t("detail.titleLabel")}</Label>
                <Input id="evenement-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{tForm("coverImage")}</Label>
                <ImageUpload
                  value={imageUrl}
                  onChange={(url) => { if (url === "") setPendingFile(null); setImageUrl(url) }}
                  prefix="adhera/evenements"
                  aspectRatio="video"
                  lazy
                  onFilePending={(blobUrl, file) => setPendingFile({ blobUrl, file })}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label={tForm("startDate")} type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
                <FormField label={tForm("endDate")} type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <LocationPicker
                label={tForm("location")}
                address={location}
                lat={lat}
                lng={lng}
                onChange={({ address, lat: newLat, lng: newLng }) => { setLocation(address); setLat(newLat); setLng(newLng) }}
              />
              <div className="grid grid-cols-2 gap-4">
                <CurrencyField
                  label={tForm("price")}
                  hint={hasTicketTypes ? tForm("priceOverriddenHint") : tForm("priceHint")}
                  value={price}
                  onChange={setPrice}
                />
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">
                    {tForm("capacity")} <span className="text-muted-foreground font-normal">{tForm("capacityHint")}</span>
                  </label>
                  <input
                    type="number" min={1} step={1} placeholder="—"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value === "" ? "" : Math.max(1, parseInt(e.target.value, 10)))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <CheckboxField
                label={tForm("waitlistEnabledLabel")}
                hint={tForm("waitlistEnabledHint")}
                checked={waitlistEnabled}
                onChange={(e) => setWaitlistEnabled(e.target.checked)}
              />
              <RichTextEditor
                label={tForm("description")}
                value={description}
                onChange={setDescription}
                placeholder={tForm("descriptionPlaceholder")}
              />
              <RichTextEditor
                label={tForm("conditionsLabel")}
                value={conditions}
                onChange={setConditions}
                placeholder={tForm("conditionsPlaceholder")}
              />
              <div className="space-y-1.5">
                <Label>{tForm("conditionsPdfLabel")}</Label>
                <DocumentUpload
                  value={attachments[0]?.url ?? ""}
                  onChange={(url) => { if (url === "") { setPendingPdf(null); setAttachments([]) } }}
                  prefix="adhera/evenements"
                  lazy
                  onFilePending={(blobUrl, file) => {
                    setPendingPdf({ blobUrl, file })
                    setAttachments([{ url: blobUrl, filename: file.name, size: file.size }])
                  }}
                />
              </div>
              <CheckboxField
                label={tForm("requireCguvLabel")}
                checked={requireCguv}
                onChange={(e) => setRequireCguv(e.target.checked)}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label={tForm("contactEmailLabel")}
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
                <FormField
                  label={tForm("contactPhoneLabel")}
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={!stepDirty.info} loading={saveMutation.isPending || uploadingImage} onClick={handleSaveInfo}>
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-tiers" value="tiers" className={stepClass("tiers")}>
          <AccordionTrigger className={stepHeaderClass("tiers")}>{stepTrigger("tiers")}</AccordionTrigger>
          <AccordionPanel>
            <EvenementTicketTypesEditor ref={tiersRef} evenementId={id} eventCapacity={capacity === "" ? null : capacity} onDirtyChange={setTiersDirty} onDraftChange={setTiersDraft} />
            <EvenementDiscountCodesEditor ref={discountCodesRef} evenementId={id} ticketTypes={tiersDraft} onDirtyChange={setDiscountCodesDirty} />
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-fields" value="fields" className={stepClass("fields")}>
          <AccordionTrigger className={stepHeaderClass("fields")}>{stepTrigger("fields")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-primary">{tSteps("fields.standardFieldsHint")}</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField label={tSteps("fields.phoneLabel")} options={requirementOptions} value={fieldPhone} onValueChange={v => setFieldPhone(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.mobileLabel")} options={requirementOptions} value={fieldMobile} onValueChange={v => setFieldMobile(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.addressLabel")} options={requirementOptions} value={fieldAddress} onValueChange={v => setFieldAddress(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.birthDateLabel")} options={requirementOptions} value={fieldBirthDate} onValueChange={v => setFieldBirthDate(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.genderLabel")} options={requirementOptions} value={fieldGender} onValueChange={v => setFieldGender(v as FieldRequirement)} />
                </div>
                <div className="flex justify-end mt-3">
                  <Button size="sm" disabled={!standardFieldsDirty} loading={saveMutation.isPending} onClick={() => saveMutation.mutate(standardFieldsPayload())}>
                    {tCommon("save")}
                  </Button>
                </div>
              </div>
              <div className="border-t pt-4">
                <EvenementCustomFieldsEditor ref={fieldsRef} evenementId={id} onDirtyChange={setFieldsDirty} />
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-products" value="products" className={stepClass("products")}>
          <AccordionTrigger className={stepHeaderClass("products")}>{stepTrigger("products")}</AccordionTrigger>
          <AccordionPanel>
            <EvenementProductsEditor ref={productsRef} evenementId={id} onDirtyChange={setProductsDirty} />
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-payment" value="payment" className={stepClass("payment")}>
          <AccordionTrigger className={stepHeaderClass("payment")}>{stepTrigger("payment")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{tSteps("payment.hint")}</p>
              <CheckboxField label={tSteps("payment.allowCashLabel")} checked={allowCash} onChange={(e) => setAllowCash(e.target.checked)} />
              <CheckboxField label={tSteps("payment.allowChequeLabel")} checked={allowCheque} onChange={(e) => setAllowCheque(e.target.checked)} />
              <CheckboxField label={tSteps("payment.allowTransferLabel")} checked={allowTransfer} onChange={(e) => setAllowTransfer(e.target.checked)} />
              {(allowCash || allowCheque || allowTransfer) && (
                <FormField
                  label={tSteps("payment.offlineInstructionsLabel")}
                  placeholder={tSteps("payment.offlineInstructionsPlaceholder")}
                  value={offlineInstructions}
                  onChange={(e) => setOfflineInstructions(e.target.value)}
                />
              )}
              <RichTextEditor label={tSteps("payment.confirmationMessageLabel")} value={confirmationMessage} onChange={setConfirmationMessage} />
              <FormField
                label={tSteps("payment.adminNotificationEmailLabel")}
                type="email"
                placeholder={tSteps("payment.adminNotificationEmailPlaceholder")}
                hint={tSteps("payment.adminNotificationEmailHint")}
                value={adminNotificationEmail}
                onChange={(e) => setAdminNotificationEmail(e.target.value)}
              />
              <div className="flex justify-end">
                <Button size="sm" disabled={!stepDirty.payment} loading={saveMutation.isPending} onClick={() => saveMutation.mutate(paymentPayload())}>
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-publish" value="publish" className={stepClass("publish")}>
          <AccordionTrigger className={stepHeaderClass("publish")}>{stepTrigger("publish")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-4">
              <SelectField
                label={tSteps("publish.visibilityLabel")}
                options={[
                  { value: "LINK",    label: tSteps("publish.visibilityLink") },
                  { value: "PRIVATE", label: tSteps("publish.visibilityPrivate") },
                ]}
                value={visibility}
                onValueChange={v => setVisibility(v as Visibility)}
              />
              <CheckboxField
                label={tSteps("publish.schedulePeriodLabel")}
                hint={tSteps("publish.schedulePeriodHint")}
                checked={scheduleEnabled}
                onChange={(e) => {
                  setScheduleEnabled(e.target.checked)
                  if (!e.target.checked) { setOpensAt(""); setClosesAt("") }
                }}
              />
              {scheduleEnabled && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label={tSteps("publish.opensAtLabel")} type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
                  <FormField label={tSteps("publish.closesAtLabel")} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!stepDirty.publish}
                  loading={saveMutation.isPending}
                  onClick={() => {
                    const payload = publishPayload()
                    if (payload) saveMutation.mutate(payload)
                  }}
                >
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <Modal
        open={leaveConfirm}
        onOpenChange={setLeaveConfirm}
        title={t("detail.leaveWarning.title")}
        description={t("detail.leaveWarning.description")}
        size="md"
        dismissable={!leaveSaving}
        footer={
          <>
            <Button variant="outline" onClick={() => setLeaveConfirm(false)} disabled={leaveSaving}>
              {tCommon("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => router.push("/dashboard/evenements")} disabled={leaveSaving}>
              {t("detail.leaveWarning.discard")}
            </Button>
            <Button onClick={handleSaveAndLeave} loading={leaveSaving}>
              {t("detail.leaveWarning.saveAndLeave")}
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={t("view.deleteConfirmTitle", { title: evenement.title })}
        description={t("view.deleteConfirmDescription")}
        confirmLabel={tCommon("delete")}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}
