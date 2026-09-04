"use client"

import { MembershipFormFieldsEditor, type MembershipFormFieldsEditorHandle } from "@/components/adhesions/membership-form-fields-editor"
import { DateTimeField } from "@/components/ui/date-time-field"
import { MembershipProductsEditor, type MembershipProductsEditorHandle } from "@/components/adhesions/membership-products-editor"
import { MembershipTiersEditor, type MembershipTiersEditorHandle } from "@/components/adhesions/membership-tiers-editor"
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion"
import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DocumentUpload } from "@/components/ui/document-upload"
import { FormField } from "@/components/ui/form-field"
import { ImageUpload } from "@/components/ui/image-upload"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/ui/modal"
import { PageHeader } from "@/components/ui/page-header"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { SelectField } from "@/components/ui/select-field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SECTION_LABELS } from "@/types/site-config"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { useSiteConfig, useSaveSiteConfig } from "@/hooks/use-site-config"
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
  InfoIcon,
  LinkIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

type MembershipFormStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"
type FieldRequirement     = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type Attachment = { url: string; filename: string; size: number }
type Visibility           = "LINK" | "SITE" | "PRIVATE"
type ValidationMode       = "IMMEDIATE" | "REQUEST"

type MembershipForm = {
  id:     string
  title:  string
  slug:   string
  status: MembershipFormStatus
  _count: { cotisations: number }

  imageUrl:             string | null
  description:          string | null
  conditions:            string | null
  attachments:          Attachment[] | null
  requireCguvSignature: boolean
  contactEmail:         string | null
  contactPhone:         string | null
  validationMode:       ValidationMode

  fieldAddress:   FieldRequirement
  fieldBirthDate: FieldRequirement
  fieldPhone:     FieldRequirement
  fieldMobile:    FieldRequirement
  fieldGender:    FieldRequirement
  fieldPhoto:     FieldRequirement
  fieldLanguage:  FieldRequirement

  allowCash:           boolean
  allowCheque:         boolean
  allowTransfer:       boolean
  offlineInstructions: string | null
  confirmationMessage: string | null
  adminNotificationEmail: string | null

  visibility:    Visibility
  siteSectionId: string | null
  opensAt:       string | null
  closesAt:      string | null
}

type SaveableFields = Partial<Omit<MembershipForm, "id" | "slug" | "status" | "_count">>

// One entry per accordion step below, in display order. Each step has its own Save button,
// so unsaved work is tracked per step — see stepDirty / stepIssue in the component.
const STEP_KEYS = ["info", "tiers", "fields", "products", "payment", "publish"] as const
// Sentinel option value in the site-section picker — selecting it creates a new "membership"
// section instead of picking an existing one. Never a real cuid/uuid, so it can't collide.
const CREATE_SITE_SECTION_VALUE = "__create__"
type StepKey = typeof STEP_KEYS[number]

// datetime-local inputs have no timezone — the value IS wall-clock local time, so this
// slices the ISO string rather than going through Date (which would apply UTC offset and
// shift the displayed hour), same convention as evenement-form.tsx.
function toDatetimeLocal(iso: string | null): string {
  return iso ? iso.slice(0, 16) : ""
}

// datetime-local's `T`-separated local string has no timezone suffix — appending nothing
// lets `new Date()` parse it as local time (matching how the browser displayed it), then
// .toISOString() gives the UTC instant the server should store.
function fromDatetimeLocal(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

export default function MembershipFormDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const qc      = useQueryClient()
  const t       = useTranslations("membershipForms")
  const tSteps  = useTranslations("membershipForms.detail.steps")
  const tCommon = useTranslations("common")
  // Same key the site editor itself uses as the default title for a newly added "membership"
  // section — reused here so a section created from this picker looks identical to one
  // created the old way, before "membership" was removed from the editor's add-section menu.
  const tSiteDefaults = useTranslations("site.defaultTitles")
  const user    = useCurrentUser()
  const { data: membreTypes = [] } = useMembreTypes()

  const [title, setTitle]                 = useState("")
  const [deleteConfirm, setDeleteConfirm]  = useState(false)
  // The Tarifs / Champs personnalisés editors own their own drafts, so they report dirtiness
  // up rather than the page trying to read it out of them.
  const [tiersDirty, setTiersDirty]        = useState(false)
  const [fieldsDirty, setFieldsDirty]      = useState(false)
  const [productsDirty, setProductsDirty]  = useState(false)
  const [leaveConfirm, setLeaveConfirm]    = useState(false)
  // "Enregistrer et quitter" in flight — keeps the leave dialog open and its buttons inert.
  const [leaveSaving, setLeaveSaving]      = useState(false)
  const [linkCopied, setLinkCopied]        = useState(false)
  // Imperative handles on the two editors that own their own drafts, so saveAll can ask them
  // to save without lifting all of that state up here.
  const tiersRef    = useRef<MembershipTiersEditorHandle>(null)
  const fieldsRef   = useRef<MembershipFormFieldsEditorHandle>(null)
  const productsRef = useRef<MembershipProductsEditorHandle>(null)
  // Controlled so a refused publish can expand the steps it is complaining about.
  const [openSteps, setOpenSteps]          = useState<StepKey[]>([])
  // Set by the first refused publish; from then on every step that would still block
  // publishing is tinted until it is fixed. Cleared once a publish goes through.
  const [publishAttempted, setPublishAttempted] = useState(false)

  // Step 1 — Informations générales
  const [imageUrl, setImageUrl]             = useState("")
  const [description, setDescription]       = useState("")
  const [conditions, setConditions]         = useState("")
  const [attachments, setAttachments]   = useState<Attachment[]>([])
  const [pendingPdf, setPendingPdf]     = useState<{ blobUrl: string; file: File } | null>(null)
  const [requireCguv, setRequireCguv]       = useState(false)
  const [contactEmail, setContactEmail]     = useState("")
  const [contactPhone, setContactPhone]     = useState("")
  const [validationMode, setValidationMode] = useState<ValidationMode>("IMMEDIATE")

  // Same lazy-upload pattern as evenement-form.tsx: picking a file only creates a local
  // blob: preview, the real /api/upload only happens on save — so navigating away without
  // saving never leaves an orphaned file in R2.
  const [pendingFile, setPendingFile] = useState<{ blobUrl: string; file: File } | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  useEffect(() => {
    if (!pendingFile) return
    return () => URL.revokeObjectURL(pendingFile.blobUrl)
  }, [pendingFile])

  // Step 3 — Matrice de champs standards
  const [fieldAddress, setFieldAddress]     = useState<FieldRequirement>("HIDDEN")
  const [fieldBirthDate, setFieldBirthDate] = useState<FieldRequirement>("HIDDEN")
  const [fieldPhone, setFieldPhone]         = useState<FieldRequirement>("HIDDEN")
  const [fieldMobile, setFieldMobile]       = useState<FieldRequirement>("HIDDEN")
  const [fieldGender, setFieldGender]       = useState<FieldRequirement>("HIDDEN")
  const [fieldPhoto, setFieldPhoto]         = useState<FieldRequirement>("HIDDEN")
  const [fieldLanguage, setFieldLanguage]   = useState<FieldRequirement>("HIDDEN")

  // Step 4 — Paiement
  const [allowCash, setAllowCash]         = useState(false)
  const [allowCheque, setAllowCheque]     = useState(false)
  const [allowTransfer, setAllowTransfer] = useState(false)
  const [offlineInstructions, setOfflineInstructions] = useState("")
  const [confirmationMessage, setConfirmationMessage] = useState("")
  const [adminNotificationEmail, setAdminNotificationEmail] = useState("")

  // Step 5 — Publication
  const [visibility, setVisibility]       = useState<Visibility>("LINK")
  const [siteSectionId, setSiteSectionId] = useState<string>("")
  const [opensAt, setOpensAt]             = useState("")
  const [closesAt, setClosesAt]           = useState("")
  // Pure UI state: whether the opening/closing date fields are shown. Off = form stays
  // open while published (both dates saved as null).
  const [scheduleEnabled, setScheduleEnabled] = useState(false)

  const { data: form, isLoading, isError } = useQuery<MembershipForm>({
    queryKey: ["membership-form", id],
    queryFn:  () => fetch(`/api/membership-forms/${id}`).then(r => {
      if (!r.ok) throw new Error("not found")
      return r.json()
    }),
  })

  // Same key and URL as MembershipTiersEditor's own query, so this is just a second
  // subscriber to the cached list (react-query dedupes the fetch). The page needs it because
  // publishing must be refused while no tier is saved — the server rejects that too, but
  // catching it here lets the Tarifs step be pointed at like any other blocking step.
  const { data: savedTiers } = useQuery<{ id: string }[]>({
    queryKey: ["membership-form", id, "tiers"],
    queryFn:  () => fetch(`/api/membership-forms/${id}/tiers`).then(r => r.json()),
  })

  // Feeds the Publication step's section picker — same query key/hook the site editor
  // itself uses (useSiteConfig), so the list always matches what an admin sees under Site
  // internet, and stays in sync when this page creates a new section below.
  const { data: siteConfigData } = useSiteConfig()
  const saveSiteConfig = useSaveSiteConfig()
  const membershipSiteSections = (siteConfigData?.config?.sections ?? []).filter(s => s.type === "membership")
  const [creatingSection, setCreatingSection] = useState(false)

  // AssoConnect's own publication step lets an admin create the target page inline instead
  // of forcing a detour to the site editor first — same idea here: a "membership" section is
  // now only ever created from this picker (see the site editor's add-section menu, which no
  // longer offers it), so this is the one and only place a fresh association gets its first one.
  async function createMembershipSection() {
    setCreatingSection(true)
    try {
      const newSection = { id: crypto.randomUUID(), type: "membership" as const, title: tSiteDefaults("membership"), body: "" }
      const sections = [...(siteConfigData?.config?.sections ?? []), newSection]
      await saveSiteConfig.mutateAsync({ sections })
      setSiteSectionId(newSection.id)
    } catch {
      toast.error(tSteps("publish.siteSectionCreateError"))
    } finally {
      setCreatingSection(false)
    }
  }

  useEffect(() => {
    if (!form) return
    setTitle(form.title)
    setImageUrl(form.imageUrl ?? "")
    setDescription(form.description ?? "")
    setConditions(form.conditions ?? "")
    setAttachments(form.attachments ?? [])
    setRequireCguv(form.requireCguvSignature)
    setContactEmail(form.contactEmail ?? "")
    setContactPhone(form.contactPhone ?? "")
    setValidationMode(form.validationMode)
    setFieldAddress(form.fieldAddress)
    setFieldBirthDate(form.fieldBirthDate)
    setFieldPhone(form.fieldPhone)
    setFieldMobile(form.fieldMobile)
    setFieldGender(form.fieldGender)
    setFieldPhoto(form.fieldPhoto)
    setFieldLanguage(form.fieldLanguage)
    setAllowCash(form.allowCash)
    setAllowCheque(form.allowCheque)
    setAllowTransfer(form.allowTransfer)
    setOfflineInstructions(form.offlineInstructions ?? "")
    setConfirmationMessage(form.confirmationMessage ?? "")
    setAdminNotificationEmail(form.adminNotificationEmail ?? "")
    setVisibility(form.visibility)
    setSiteSectionId(form.siteSectionId ?? "")
    setOpensAt(toDatetimeLocal(form.opensAt))
    setClosesAt(toDatetimeLocal(form.closesAt))
    setScheduleEnabled(!!(form.opensAt || form.closesAt))
  }, [form])

  const saveMutation = useMutation({
    mutationFn: async (data: SaveableFields) => {
      const res = await fetch(`/api/membership-forms/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("detail.toasts.saveError"))
      return res.json() as Promise<MembershipForm>
    },
    onSuccess: (updated) => {
      qc.setQueryData(["membership-form", id], updated)
      qc.invalidateQueries({ queryKey: ["membership-forms"] })
      toast.success(t("detail.toasts.saved"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("detail.toasts.saveError")),
  })

  // What each step's Save button persists. saveAll() below reuses the same builders so
  // "Enregistrer et quitter" writes exactly what the buttons would have.
  //
  // Uploads the pending image / conditions PDF first (same lazy pattern as
  // evenement-form.tsx's handleFormSubmit, so a cancelled edit never leaves an orphaned file
  // in R2) and returns null when a step cannot be saved — the reason has already been toasted.
  async function infoPayload(): Promise<SaveableFields | null> {
    if (!title.trim()) {
      toast.error(t("detail.titleRequired"))
      return null
    }
    let resolvedImageUrl = imageUrl || null
    if (pendingFile) {
      setUploadingImage(true)
      try {
        const fd = new FormData()
        fd.append("file", pendingFile.file)
        fd.append("prefix", "adhera/adhesions")
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
        fd.append("prefix", "adhera/adhesions")
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
    return {
      title: title.trim(),
      imageUrl: resolvedImageUrl,
      description: description || null,
      conditions: conditions || null,
      attachments: resolvedAttachments,
      requireCguvSignature: requireCguv,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      validationMode,
    }
  }
  const standardFieldsPayload = (): SaveableFields => ({
    fieldAddress, fieldBirthDate, fieldPhone, fieldMobile, fieldGender, fieldPhoto, fieldLanguage,
  })
  const paymentPayload = (): SaveableFields => ({
    allowCash, allowCheque, allowTransfer,
    offlineInstructions:    offlineInstructions || null,
    confirmationMessage:    confirmationMessage || null,
    adminNotificationEmail: adminNotificationEmail || null,
  })
  function publishPayload(): SaveableFields | null {
    if (opensAt && closesAt && opensAt >= closesAt) {
      toast.error(tSteps("publish.datesOrderError"))
      return null
    }
    if (visibility === "SITE" && !siteSectionId) {
      toast.error(tSteps("publish.siteSectionRequiredError"))
      return null
    }
    return {
      visibility,
      siteSectionId: visibility === "SITE" ? siteSectionId : null,
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
      const res = await fetch(`/api/membership-forms/${id}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.statusError"))
      return res.json() as Promise<MembershipForm>
    },
    onSuccess: (result, action) => {
      if (action === "duplicate") {
        qc.invalidateQueries({ queryKey: ["membership-forms"] })
        toast.success(t("formsView.toasts.duplicated"))
        router.push(`/dashboard/adhesions/${result.id}`)
        return
      }
      qc.setQueryData(["membership-form", id], result)
      qc.invalidateQueries({ queryKey: ["membership-forms"] })
      if (action === "publish") setPublishAttempted(false)
      toast.success(t("formsView.toasts.statusUpdated"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.statusError")),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/membership-forms/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.deleteError"))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["membership-forms"] })
      toast.success(t("formsView.toasts.deleted"))
      router.push("/dashboard/adhesions")
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.deleteError")),
  })

  // Every value a Save button on this page persists, grouped by the step whose Save button
  // writes it. Must stay in sync with the payload builders above (infoPayload,
  // standardFieldsPayload, paymentPayload, publishPayload): a field that is editable but
  // missing here would be dropped on navigation with no warning at all — and would not stop
  // a publish either.
  const changed = (edited: unknown[], saved: unknown[]) => JSON.stringify(edited) !== JSON.stringify(saved)
  // The Formulaire step has two Save buttons — the standard-field matrix and the custom fields
  // editor's own — so its halves are tracked apart (each greys out its own button) and merged
  // for the step.
  const standardFieldsDirty = !!form && changed(
    [fieldAddress, fieldBirthDate, fieldPhone, fieldMobile, fieldGender, fieldPhoto, fieldLanguage],
    [form.fieldAddress, form.fieldBirthDate, form.fieldPhone, form.fieldMobile, form.fieldGender, form.fieldPhoto, form.fieldLanguage],
  )
  const stepDirty: Record<StepKey, boolean> = {
    // A picked-but-not-yet-uploaded file only lives in memory (see the lazy-upload pattern
    // above), so it counts as unsaved work even though no persisted field changed yet.
    info: !!form && (!!pendingFile || !!pendingPdf || changed(
      [title, imageUrl, description, conditions, attachments, requireCguv, contactEmail, contactPhone, validationMode],
      [form.title, form.imageUrl ?? "", form.description ?? "", form.conditions ?? "", form.attachments ?? [],
        form.requireCguvSignature, form.contactEmail ?? "", form.contactPhone ?? "", form.validationMode],
    )),
    tiers: tiersDirty,
    fields: fieldsDirty || standardFieldsDirty,
    products: productsDirty,
    payment: !!form && changed(
      [allowCash, allowCheque, allowTransfer, offlineInstructions, confirmationMessage, adminNotificationEmail],
      [form.allowCash, form.allowCheque, form.allowTransfer, form.offlineInstructions ?? "", form.confirmationMessage ?? "", form.adminNotificationEmail ?? ""],
    ),
    publish: !!form && changed(
      [visibility, siteSectionId, opensAt, closesAt],
      [form.visibility, form.siteSectionId ?? "", toDatetimeLocal(form.opensAt), toDatetimeLocal(form.closesAt)],
    ),
  }

  const isDirty = STEP_KEYS.some(k => stepDirty[k])

  // What would stop a publish right now, per step. Derived from live state on purpose: as soon
  // as a step is saved (or a tier added) its issue clears, and with it the tint below.
  const stepIssue = (key: StepKey): "unsaved" | "noTiers" | null =>
    stepDirty[key] ? "unsaved"
    : key === "tiers" && savedTiers?.length === 0 ? "noTiers"
    : null

  // Covers tab close / reload / external links, which client-side routing never sees. The
  // browser shows its own generic wording here — returnValue only has to be set, its text
  // is ignored by every current browser.
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  if (isLoading) return <DetailLoadingSkeleton />
  if (isError || !form) {
    return (
      <DetailNotFound
        message={t("detail.notFound")}
        backHref="/dashboard/adhesions"
        backLabel={t("detail.backToList")}
      />
    )
  }

  const STATUS_LABEL   = { DRAFT: t("formStatus.draft"), PUBLISHED: t("formStatus.published"), ARCHIVED: t("formStatus.archived") }
  const STATUS_VARIANT: Record<MembershipFormStatus, "secondary" | "default" | "outline"> = {
    DRAFT: "secondary", PUBLISHED: "default", ARCHIVED: "outline",
  }
  const canDelete = form._count.cotisations === 0

  const requirementOptions = [
    { value: "REQUIRED", label: tSteps("fields.requirement.required") },
    { value: "OPTIONAL", label: tSteps("fields.requirement.optional") },
    { value: "HIDDEN",   label: tSteps("fields.requirement.hidden") },
  ]

  // window.location.origin read only at click time (not during render) — sidesteps the
  // SSR/hydration-mismatch concern, since this button never displays the URL itself, only
  // copies it.
  // Opens the public page with ?preview=1 — the public GET lets a logged-in manager of this
  // association through the PUBLISHED gate for that flag (src/lib/form-preview.ts), so a
  // draft can be checked before publishing; the page disables submission in that mode.
  function handlePreview() {
    if (!user.associationSlug || !form) return
    window.open(`${BASE_PATH}/${user.associationSlug}/adhesion/${form.slug}?preview=1`, "_blank", "noopener")
  }

  async function handleCopyLink() {
    if (!user.associationSlug || !form) return
    const url = `${window.location.origin}${BASE_PATH}/${user.associationSlug}/adhesion/${form.slug}`
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
    info:     tSteps("info.title"),
    tiers:    tSteps("tiers.title"),
    fields:   tSteps("fields.title"),
    products: tSteps("products.title"),
    payment:  tSteps("payment.title"),
    publish:  tSteps("publish.title"),
  }

  // Refuses to publish while any step still has unsaved edits (each step has its own Save
  // button, so it is easy to leave one behind) or while no tier is saved. The offending steps
  // are expanded, tinted and named in the toast; the first one is scrolled into view.
  function handlePublish() {
    const blocked = STEP_KEYS.filter(k => stepIssue(k) !== null)
    if (blocked.length === 0) {
      publishMutation.mutate("publish")
      return
    }
    setPublishAttempted(true)
    setOpenSteps(prev => Array.from(new Set([...prev, ...blocked])))
    const unsaved = blocked.filter(k => stepIssue(k) === "unsaved")
    toast.error(unsaved.length > 0
      ? t("detail.publishBlocked.unsavedToast", { steps: unsaved.map(k => stepTitles[k]).join(", ") })
      : t("detail.publishBlocked.noTiersToast"))
    document.getElementById(`step-${blocked[0]}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // Saves every step that still has unsaved work: the two editors that own their drafts first
  // (each validates and toasts on its own), then one PATCH for the page-level steps. Stops at
  // the first failure and returns false so the caller stays on the page.
  async function saveAll(): Promise<boolean> {
    if (tiersDirty    && !(await tiersRef.current?.save()))    return false
    if (fieldsDirty   && !(await fieldsRef.current?.save()))   return false
    if (productsDirty && !(await productsRef.current?.save())) return false
    let payload: SaveableFields = {}
    if (stepDirty.info) {
      const info = await infoPayload()
      if (!info) return false
      payload = { ...payload, ...info }
    }
    if (standardFieldsDirty) payload = { ...payload, ...standardFieldsPayload() }
    if (stepDirty.payment)   payload = { ...payload, ...paymentPayload() }
    if (stepDirty.publish) {
      const publish = publishPayload()
      if (!publish) return false
      payload = { ...payload, ...publish }
    }
    if (Object.keys(payload).length === 0) return true
    try {
      await saveMutation.mutateAsync(payload) // its onError has already toasted on failure
      return true
    } catch {
      return false
    }
  }

  async function handleSaveAndLeave() {
    setLeaveSaving(true)
    try {
      if (await saveAll()) router.push("/dashboard/adhesions")
    } finally {
      setLeaveSaving(false)
    }
  }

  // Tint + inline tag on a step that blocked the last publish attempt. A plain background on
  // the item (no border, no badge) keeps the accordion reading as one surface.
  const stepClass = (key: StepKey) =>
    cn(
      "overflow-hidden rounded-lg border bg-card",
      publishAttempted && stepIssue(key) && "bg-destructive/10",
    )
  // Off-white header at full --muted (the /50 tints read as white on bg-card); hover eases
  // toward the card like the secondary button's own hover:bg-secondary/80. A flagged step
  // keeps the transparent header so the item's destructive tint and tag stay legible.
  const stepHeaderClass = (key: StepKey) =>
    publishAttempted && stepIssue(key)
      ? undefined
      : "bg-muted hover:bg-muted/80"
  function stepTrigger(key: StepKey) {
    const issue = publishAttempted ? stepIssue(key) : null
    return (
      <span className="flex items-center gap-2">
        {stepTitles[key]}
        {issue && (
          <span className="text-xs font-normal text-destructive">
            {issue === "unsaved" ? t("detail.publishBlocked.unsavedTag") : t("detail.publishBlocked.noTiersTag")}
          </span>
        )}
      </span>
    )
  }

  return (
    <div className="space-y-4">
      <BackLink
        href="/dashboard/adhesions"
        onClick={e => { if (isDirty) { e.preventDefault(); setLeaveConfirm(true) } }}
      >
        {t("detail.backToList")}
      </BackLink>

      <PageHeader
        title={form.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[form.status]}>{STATUS_LABEL[form.status]}</Badge>
            {form.status === "DRAFT" && (
              <span className="text-xs text-muted-foreground">{t("detail.draftNotice")}</span>
            )}
          </span>
        }
        action={
          <div className="flex gap-2">
            {form.status !== "PUBLISHED" ? (
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
            {form.status === "PUBLISHED" && (
              <Button size="sm" variant="ghost" onClick={handleCopyLink}>
                {linkCopied ? <CheckIcon className="mr-1.5 size-4" /> : <LinkIcon className="mr-1.5 size-4" />}
                {t("detail.copyLinkButton")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => publishMutation.mutate("duplicate")} loading={publishMutation.isPending}>
              <CopyIcon className="mr-1.5 size-4" />
              {t("detail.duplicateButton")}
            </Button>
            {form.status !== "ARCHIVED" && (
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

      {/* keepMounted: Base UI unmounts a closed panel by default, which threw away whatever
          the Tarifs / Champs editors held in local state the moment you collapsed them. */}
      {/* Detached steps: the shared joined-container chrome moves onto each item instead. */}
      <Accordion multiple value={openSteps} onValueChange={v => setOpenSteps(v as StepKey[])} keepMounted className="space-y-3 rounded-none border-0 bg-transparent divide-y-0">
        <AccordionItem id="step-info" value="info" className={stepClass("info")}>
          <AccordionTrigger className={stepHeaderClass("info")}>{stepTrigger("info")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-4">
              {/* The title used to save itself on blur — which also fired when clicking the
                  back link, so "leave without saving" still saved it. It now goes through this
                  step's Save button like every other field. */}
              <div className="max-w-xl space-y-1.5">
                <Label htmlFor="form-title">{t("detail.titleLabel")}</Label>
                <Input
                  id="form-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{tSteps("info.imageLabel")}</Label>
                <ImageUpload
                  value={imageUrl}
                  onChange={(url) => { if (url === "") setPendingFile(null); setImageUrl(url) }}
                  prefix="adhera/adhesions"
                  aspectRatio="wide"
                  lazy
                  onFilePending={(blobUrl, file) => setPendingFile({ blobUrl, file })}
                />
              </div>
              <RichTextEditor
                label={tSteps("info.descriptionLabel")}
                value={description}
                onChange={setDescription}
                placeholder={tSteps("info.descriptionPlaceholder")}
              />
              <RichTextEditor
                label={tSteps("info.conditionsLabel")}
                value={conditions}
                onChange={setConditions}
                placeholder={tSteps("info.conditionsPlaceholder")}
              />
              <div className="space-y-1.5">
                <Label>{tSteps("info.conditionsPdfLabel")}</Label>
                <DocumentUpload
                  value={attachments[0]?.url ?? ""}
                  onChange={(url) => { if (url === "") { setPendingPdf(null); setAttachments([]) } }}
                  prefix="adhera/adhesions"
                  lazy
                  onFilePending={(blobUrl, file) => {
                    setPendingPdf({ blobUrl, file })
                    setAttachments([{ url: blobUrl, filename: file.name, size: file.size }])
                  }}
                />
              </div>
              <CheckboxField
                label={tSteps("info.requireCguvLabel")}
                checked={requireCguv}
                onChange={(e) => setRequireCguv(e.target.checked)}
              />
              <div className="space-y-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                  {tSteps("info.contactSectionTitle")}
                  <Tooltip>
                    <TooltipTrigger
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={tSteps("info.contactSectionHintAria")}
                    >
                      <InfoIcon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-64 whitespace-normal text-left">
                      {tSteps("info.contactSectionHint")}
                    </TooltipContent>
                  </Tooltip>
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    label={tSteps("info.contactEmailLabel")}
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                  <FormField
                    label={tSteps("info.contactPhoneLabel")}
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="max-w-sm space-y-1.5">
                <SelectField
                  label={tSteps("info.validationModeLabel")}
                  options={[
                    { value: "IMMEDIATE", label: tSteps("info.validationModeImmediate") },
                    { value: "REQUEST",   label: tSteps("info.validationModeRequest") },
                  ]}
                  value={validationMode}
                  onValueChange={v => setValidationMode(v as ValidationMode)}
                />
                <p className="text-xs text-muted-foreground">{tSteps("info.validationModeHint")}</p>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!stepDirty.info}
                  loading={saveMutation.isPending || uploadingImage}
                  onClick={handleSaveInfo}
                >
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-tiers" value="tiers" className={stepClass("tiers")}>
          <AccordionTrigger className={stepHeaderClass("tiers")}>{stepTrigger("tiers")}</AccordionTrigger>
          <AccordionPanel>
            <MembershipTiersEditor ref={tiersRef} formId={id} membreTypes={membreTypes} onDirtyChange={setTiersDirty} />
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-fields" value="fields" className={stepClass("fields")}>
          <AccordionTrigger className={stepHeaderClass("fields")}>{stepTrigger("fields")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-primary">{tSteps("fields.standardFieldsHint")}</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField label={tSteps("fields.addressLabel")} options={requirementOptions} value={fieldAddress} onValueChange={v => setFieldAddress(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.birthDateLabel")} options={requirementOptions} value={fieldBirthDate} onValueChange={v => setFieldBirthDate(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.phoneLabel")} options={requirementOptions} value={fieldPhone} onValueChange={v => setFieldPhone(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.mobileLabel")} options={requirementOptions} value={fieldMobile} onValueChange={v => setFieldMobile(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.genderLabel")} options={requirementOptions} value={fieldGender} onValueChange={v => setFieldGender(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.photoLabel")} options={requirementOptions} value={fieldPhoto} onValueChange={v => setFieldPhoto(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.languageLabel")} options={requirementOptions} value={fieldLanguage} onValueChange={v => setFieldLanguage(v as FieldRequirement)} />
                </div>
                <div className="flex justify-end mt-3">
                  <Button
                    size="sm"
                    disabled={!standardFieldsDirty}
                    loading={saveMutation.isPending}
                    onClick={() => saveMutation.mutate(standardFieldsPayload())}
                  >
                    {tCommon("save")}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4">
                <MembershipFormFieldsEditor ref={fieldsRef} formId={id} onDirtyChange={setFieldsDirty} />
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-products" value="products" className={stepClass("products")}>
          <AccordionTrigger className={stepHeaderClass("products")}>{stepTrigger("products")}</AccordionTrigger>
          <AccordionPanel>
            <MembershipProductsEditor ref={productsRef} formId={id} onDirtyChange={setProductsDirty} />
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-payment" value="payment" className={stepClass("payment")}>
          <AccordionTrigger className={stepHeaderClass("payment")}>{stepTrigger("payment")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{tSteps("payment.hint")}</p>
              <CheckboxField
                label={tSteps("payment.allowCashLabel")}
                checked={allowCash}
                onChange={(e) => setAllowCash(e.target.checked)}
              />
              <CheckboxField
                label={tSteps("payment.allowChequeLabel")}
                checked={allowCheque}
                onChange={(e) => setAllowCheque(e.target.checked)}
              />
              <CheckboxField
                label={tSteps("payment.allowTransferLabel")}
                checked={allowTransfer}
                onChange={(e) => setAllowTransfer(e.target.checked)}
              />
              {(allowCash || allowCheque || allowTransfer) && (
                <FormField
                  label={tSteps("payment.offlineInstructionsLabel")}
                  placeholder={tSteps("payment.offlineInstructionsPlaceholder")}
                  value={offlineInstructions}
                  onChange={(e) => setOfflineInstructions(e.target.value)}
                />
              )}
              <RichTextEditor
                label={tSteps("payment.confirmationMessageLabel")}
                value={confirmationMessage}
                onChange={setConfirmationMessage}
              />
              <FormField
                label={tSteps("payment.adminNotificationEmailLabel")}
                type="email"
                placeholder={tSteps("payment.adminNotificationEmailPlaceholder")}
                hint={tSteps("payment.adminNotificationEmailHint")}
                value={adminNotificationEmail}
                onChange={(e) => setAdminNotificationEmail(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!stepDirty.payment}
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate(paymentPayload())}
                >
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
                  { value: "SITE",    label: tSteps("publish.visibilitySite") },
                  { value: "PRIVATE", label: tSteps("publish.visibilityPrivate") },
                ]}
                value={visibility}
                onValueChange={v => setVisibility(v as Visibility)}
              />
              {visibility === "SITE" && (
                <SelectField
                  label={tSteps("publish.siteSectionLabel")}
                  required
                  disabled={creatingSection}
                  placeholder={tSteps("publish.siteSectionPlaceholder")}
                  options={[
                    ...membershipSiteSections.map(s => ({ value: s.id, label: s.title || SECTION_LABELS.membership })),
                    { value: CREATE_SITE_SECTION_VALUE, label: tSteps("publish.siteSectionCreateOption") },
                  ]}
                  value={siteSectionId}
                  onValueChange={v => {
                    if (v === CREATE_SITE_SECTION_VALUE) createMembershipSection()
                    else setSiteSectionId(v)
                  }}
                />
              )}
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
                  <DateTimeField
                    label={tSteps("publish.opensAtLabel")}
                    allowFuture
                    value={opensAt}
                    onChange={setOpensAt}
                  />
                  <DateTimeField
                    label={tSteps("publish.closesAtLabel")}
                    allowFuture
                    min={opensAt || undefined}
                    value={closesAt}
                    onChange={setClosesAt}
                  />
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
            <Button variant="destructive" onClick={() => router.push("/dashboard/adhesions")} disabled={leaveSaving}>
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
        title={t("formsView.deleteTitle")}
        description={t("formsView.deleteDescription", { title: form.title })}
        confirmLabel={tCommon("delete")}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}
