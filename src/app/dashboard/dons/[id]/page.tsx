"use client"

import { DonationFormFieldsEditor, type DonationFormFieldsEditorHandle } from "@/components/dons/donation-form-fields-editor"
import { DateTimeField } from "@/components/ui/date-time-field"
import { DonationTiersEditor, type DonationTiersEditorHandle } from "@/components/dons/donation-tiers-editor"
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
import { BASE_PATH } from "@/lib/env"
import { cn } from "@/lib/utils"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { useDonationForms } from "@/hooks/use-donation-forms"
import { useSiteConfig, useSaveSiteConfig } from "@/hooks/use-site-config"
import { publishConfirmDescription } from "@/lib/dons/publish-confirm-description"
import { findDonationFormsOnSiteSection } from "@/lib/dons/site-section-picks"
import { SECTION_LABELS } from "@/types/site-config"
import {
  ArchiveIcon,
  CheckIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CopyIcon,
  EyeIcon,
  InfoIcon,
  LinkIcon,
  TrashIcon
} from "@phosphor-icons/react/dist/ssr"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

type DonationFormStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"
type FieldRequirement   = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type Attachment = { url: string; filename: string; size: number }
type Visibility         = "LINK" | "SITE" | "PRIVATE"

const CREATE_SITE_SECTION_VALUE = "__create__"

type DonationForm = {
  id:     string
  title:  string
  slug:   string
  status: DonationFormStatus
  _count: { dons: number; subscriptions: number }

  imageUrl:             string | null
  description:          string | null
  conditions:            string | null
  attachments:          Attachment[] | null
  requireCguvSignature: boolean
  contactEmail:         string | null
  contactPhone:         string | null

  fieldAddress:   FieldRequirement
  fieldBirthDate: FieldRequirement
  fieldPhone:     FieldRequirement
  fieldMobile:    FieldRequirement
  fieldGender:    FieldRequirement

  allowOnline:         boolean
  allowCash:           boolean
  allowCheque:         boolean
  allowTransfer:       boolean
  offlineInstructions: string | null

  visibility:    Visibility
  siteSectionId: string | null
  opensAt:       string | null
  closesAt:      string | null
}

type SaveableFields = Partial<Omit<DonationForm, "id" | "slug" | "status" | "_count">>

// One entry per accordion step below, in display order. Each step has its own Save button,
// so unsaved work is tracked per step — see stepDirty / stepIssue in the component.
const STEP_KEYS = ["info", "tiers", "fields", "payment", "publish"] as const
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

export default function DonationFormDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const qc      = useQueryClient()
  const t       = useTranslations("donationForms")
  const tSteps  = useTranslations("donationForms.detail.steps")
  const tCommon = useTranslations("common")
  const tSiteDefaults = useTranslations("site.defaultTitles")
  const user    = useCurrentUser()
  const modules = useModules()

  const [title, setTitle]                 = useState("")
  const [deleteConfirm, setDeleteConfirm]  = useState(false)
  const [publishConfirm, setPublishConfirm] = useState<"publish" | "unpublish" | null>(null)
  // "deleteBlocked": Supprimer on a form that has received donations, which can only be archived.
  const [archiveConfirm, setArchiveConfirm] = useState<"archive" | "deleteBlocked" | null>(null)
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState(false)
  // The Paliers / Champs personnalisés editors own their own drafts, so they report dirtiness
  // up rather than the page trying to read it out of them.
  const [tiersDirty, setTiersDirty]        = useState(false)
  const [fieldsDirty, setFieldsDirty]      = useState(false)
  const [leaveConfirm, setLeaveConfirm]    = useState(false)
  // "Enregistrer et quitter" in flight — keeps the leave dialog open and its buttons inert.
  const [leaveSaving, setLeaveSaving]      = useState(false)
  const [linkCopied, setLinkCopied]        = useState(false)
  // Imperative handles on the two editors that own their own drafts, so saveAll can ask them
  // to save without lifting all of that state up here.
  const tiersRef  = useRef<DonationTiersEditorHandle>(null)
  const fieldsRef = useRef<DonationFormFieldsEditorHandle>(null)
  // Controlled so a refused publish can expand the steps it is complaining about.
  const [openSteps, setOpenSteps]          = useState<StepKey[]>([])
  // Set by the first refused publish; from then on every step that would still block
  // publishing is tinted until it is fixed. Cleared once a publish goes through.
  const [publishAttempted, setPublishAttempted] = useState(false)

  // Step 1 — Informations générales
  const [imageUrl, setImageUrl]         = useState("")
  const [description, setDescription]   = useState("")
  const [conditions, setConditions]     = useState("")
  const [attachments, setAttachments]   = useState<Attachment[]>([])
  const [pendingPdf, setPendingPdf]     = useState<{ blobUrl: string; file: File } | null>(null)
  const [requireCguv, setRequireCguv]   = useState(false)
  const [contactEmail, setContactEmail] = useState("")
  const [contactPhone, setContactPhone] = useState("")

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

  // Step 4 — Paiement
  const [allowOnline, setAllowOnline]     = useState(true)
  const [allowCash, setAllowCash]         = useState(false)
  const [allowCheque, setAllowCheque]     = useState(false)
  const [allowTransfer, setAllowTransfer] = useState(false)
  const [offlineInstructions, setOfflineInstructions] = useState("")

  // Step 5 — Publication
  const [visibility, setVisibility]       = useState<Visibility>("LINK")
  const [siteSectionId, setSiteSectionId] = useState("")
  const [opensAt, setOpensAt]             = useState("")
  const [closesAt, setClosesAt]           = useState("")

  const { data: form, isLoading, isError } = useQuery<DonationForm>({
    queryKey: ["donation-form", id],
    queryFn:  () => fetch(`/api/donation-forms/${id}`).then(r => {
      if (!r.ok) throw new Error("not found")
      return r.json()
    }),
  })

  // Same key and URL as DonationTiersEditor's own query, so this is just a second subscriber
  // to the cached list. The page needs it because publishing must be refused while no tier is
  // saved — the publish route rejects that too, but catching it here lets the Paliers step be
  // pointed at like any other blocking step.
  const { data: savedTiers } = useQuery<{ id: string }[]>({
    queryKey: ["donation-form", id, "tiers"],
    queryFn:  () => fetch(`/api/donation-forms/${id}/tiers`).then(response => response.json()),
  })

  // Feeds the Publication step's section picker — same query key/hook the site editor
  // itself uses (useSiteConfig), so the list always matches what an admin sees under Site
  // internet, and stays in sync when this page creates a new section below.
  const { data: siteConfigData } = useSiteConfig()
  const saveSiteConfig = useSaveSiteConfig()
  const donsSiteSections = (siteConfigData?.config?.sections ?? []).filter(s => s.type === "dons")
  const [creatingSection, setCreatingSection] = useState(false)

  // Every form of the association: tells the Publication step and the publish confirmation
  // which form a site section shows today.
  const { data: donationForms } = useDonationForms()

  // Mirrors MembershipForm's own createMembershipSection: lets an admin create the target
  // "dons" section inline instead of forcing a detour to the site editor first.
  async function createDonsSection() {
    setCreatingSection(true)
    try {
      const newSection = { id: crypto.randomUUID(), type: "dons" as const, title: tSiteDefaults("dons"), body: "", buttonLabel: "" }
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
    setFieldAddress(form.fieldAddress)
    setFieldBirthDate(form.fieldBirthDate)
    setFieldPhone(form.fieldPhone)
    setFieldMobile(form.fieldMobile)
    setFieldGender(form.fieldGender)
    setAllowOnline(form.allowOnline)
    setAllowCash(form.allowCash)
    setAllowCheque(form.allowCheque)
    setAllowTransfer(form.allowTransfer)
    setOfflineInstructions(form.offlineInstructions ?? "")
    setVisibility(form.visibility)
    setSiteSectionId(form.siteSectionId ?? "")
    setOpensAt(toDatetimeLocal(form.opensAt))
    setClosesAt(toDatetimeLocal(form.closesAt))
  }, [form])

  const saveMutation = useMutation({
    mutationFn: async (data: SaveableFields) => {
      const res = await fetch(`/api/donation-forms/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("detail.toasts.saveError"))
      return res.json() as Promise<DonationForm>
    },
    onSuccess: (updated) => {
      qc.setQueryData(["donation-form", id], updated)
      qc.invalidateQueries({ queryKey: ["donation-forms"] })
      toast.success(t("detail.toasts.saved"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("detail.toasts.saveError")),
  })

  // Returns the stored file's URL, or null when the upload failed — already toasted by then.
  async function uploadPendingFile(file: File): Promise<string | null> {
    setUploadingImage(true)
    try {
      const uploadBody = new FormData()
      uploadBody.append("file", file)
      uploadBody.append("prefix", "adhera/dons")
      const response = await fetch("/api/upload", { method: "POST", body: uploadBody })
      if (!response.ok) { toast.error(t("detail.toasts.saveError")); return null }
      const { url } = (await response.json()) as { url: string }
      return url
    } finally {
      setUploadingImage(false)
    }
  }

  // Only once the PATCH went through: clearing earlier revokes the blob: previews while the
  // step is still unsaved, and a retry would then send those dead blob: URLs.
  function clearPendingUploads() {
    setPendingFile(null)
    setPendingPdf(null)
  }

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
      resolvedImageUrl = await uploadPendingFile(pendingFile.file)
      if (!resolvedImageUrl) return null
    }
    let resolvedAttachments = attachments
    if (pendingPdf) {
      const uploadedPdfUrl = await uploadPendingFile(pendingPdf.file)
      if (!uploadedPdfUrl) return null
      resolvedAttachments = [{ url: uploadedPdfUrl, filename: pendingPdf.file.name, size: pendingPdf.file.size }]
    }
    return {
      title:                title.trim(),
      imageUrl:             resolvedImageUrl,
      description:          description || null,
      conditions:           conditions || null,
      attachments:          resolvedAttachments,
      requireCguvSignature: requireCguv,
      contactEmail:         contactEmail || null,
      contactPhone:         contactPhone || null,
    }
  }
  const standardFieldsPayload = (): SaveableFields => ({
    fieldAddress, fieldBirthDate, fieldPhone, fieldMobile, fieldGender,
  })
  const paymentPayload = (): SaveableFields => ({
    allowOnline, allowCash, allowCheque, allowTransfer,
    offlineInstructions: offlineInstructions || null,
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
    if (payload) saveMutation.mutate(payload, { onSuccess: clearPendingUploads })
  }

  const publishMutation = useMutation({
    mutationFn: async (action: "publish" | "unpublish" | "archive" | "duplicate") => {
      const res = await fetch(`/api/donation-forms/${id}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.statusError"))
      return res.json() as Promise<DonationForm>
    },
    onSuccess: (result, action) => {
      if (action === "duplicate") {
        qc.invalidateQueries({ queryKey: ["donation-forms"] })
        toast.success(t("formsView.toasts.duplicated"))
        router.push(`/dashboard/dons/${result.id}`)
        return
      }
      qc.setQueryData(["donation-form", id], result)
      // Publishing or archiving can also move another form off its site section.
      qc.invalidateQueries({ queryKey: ["donation-forms"] })
      qc.invalidateQueries({ queryKey: ["donation-form", id], exact: true })
      qc.invalidateQueries({ queryKey: ["site-preview-data"] })
      if (action === "publish") setPublishAttempted(false)
      toast.success(t("formsView.toasts.statusUpdated"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.statusError")),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/donation-forms/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.deleteError"))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["donation-forms"] })
      toast.success(t("formsView.toasts.deleted"))
      router.push("/dashboard/dons")
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.deleteError")),
  })

  // Every value a Save button on this page persists, grouped by the step whose Save button
  // writes it, normalised exactly like the fill effect above so a freshly loaded (or freshly
  // saved) form compares clean. Must stay in sync with the payload builders: a field that is
  // editable but missing here would be dropped on navigation with no warning at all — and
  // would not stop a publish either.
  const changed = (edited: unknown[], saved: unknown[]) => JSON.stringify(edited) !== JSON.stringify(saved)
  // The Formulaire step has two Save buttons — the standard-field matrix and the custom fields
  // editor's own — so its halves are tracked apart (each greys out its own button) and merged
  // for the step.
  const standardFieldsDirty = !!form && changed(
    [fieldAddress, fieldBirthDate, fieldPhone, fieldMobile, fieldGender],
    [form.fieldAddress, form.fieldBirthDate, form.fieldPhone, form.fieldMobile, form.fieldGender],
  )
  const stepDirty: Record<StepKey, boolean> = {
    // A picked-but-not-yet-uploaded file only lives in memory (see the lazy-upload pattern
    // above), so it counts as unsaved work even though no persisted field changed yet.
    info: !!form && (!!pendingFile || !!pendingPdf || changed(
      [title, imageUrl, description, conditions, attachments, requireCguv, contactEmail, contactPhone],
      [form.title, form.imageUrl ?? "", form.description ?? "", form.conditions ?? "", form.attachments ?? [],
        form.requireCguvSignature, form.contactEmail ?? "", form.contactPhone ?? ""],
    )),
    tiers: tiersDirty,
    fields: fieldsDirty || standardFieldsDirty,
    payment: !!form && changed(
      [allowOnline, allowCash, allowCheque, allowTransfer, offlineInstructions],
      [form.allowOnline, form.allowCash, form.allowCheque, form.allowTransfer, form.offlineInstructions ?? ""],
    ),
    publish: !!form && changed(
      [visibility, siteSectionId, opensAt, closesAt],
      [form.visibility, form.siteSectionId ?? "", toDatetimeLocal(form.opensAt), toDatetimeLocal(form.closesAt)],
    ),
  }

  const isDirty = STEP_KEYS.some(stepKey => stepDirty[stepKey])

  // What would stop a publish right now, per step. Derived from live state on purpose: as soon
  // as a step is saved (or a tier added) its issue clears, and with it the tint below.
  const stepIssue = (stepKey: StepKey): "unsaved" | "noTiers" | null =>
    stepDirty[stepKey] ? "unsaved"
    : stepKey === "tiers" && savedTiers?.length === 0 ? "noTiers"
    : null

  // Covers tab close / reload / external links, which client-side routing never sees. The
  // browser shows its own generic wording here — returnValue only has to be set, its text
  // is ignored by every current browser.
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  if (isLoading) return <DetailLoadingSkeleton />
  if (isError || !form) {
    return (
      <DetailNotFound
        message={t("detail.notFound")}
        backHref="/dashboard/dons"
        backLabel={t("detail.backToList")}
      />
    )
  }

  const STATUS_LABEL   = { DRAFT: t("formStatus.draft"), PUBLISHED: t("formStatus.published"), ARCHIVED: t("formStatus.archived") }
  const STATUS_VARIANT: Record<DonationFormStatus, "secondary" | "default" | "outline"> = {
    DRAFT: "secondary", PUBLISHED: "default", ARCHIVED: "outline",
  }
  // Same rule as the DELETE route: a form that has received donations can only be archived.
  const hasDonations   = form._count.dons > 0 || form._count.subscriptions > 0
  const recurringNote  = form._count.subscriptions > 0 ? ` ${t("formsView.archiveConfirm.recurringNote")}` : ""
  const archivePending = publishMutation.isPending && publishMutation.variables === "archive"

  function handleDelete() {
    if (!hasDonations) setDeleteConfirm(true)
    else if (form?.status === "ARCHIVED") setDeleteBlockedInfo(true)
    else setArchiveConfirm("deleteBlocked")
  }

  // Publication step warnings, only about a placement change not saved yet.
  const donsSectionTitle = (sectionId: string | null) => {
    const section = donsSiteSections.find(existingSection => existingSection.id === sectionId)
    return section ? section.title || SECTION_LABELS.dons : null
  }
  const pickedSectionChanged = visibility === "SITE" && !!siteSectionId
    && !(form.visibility === "SITE" && form.siteSectionId === siteSectionId)
  const formOnPickedSection = pickedSectionChanged
    ? findDonationFormsOnSiteSection(donationForms ?? [], siteSectionId, form.id)[0]
    : undefined
  // Only when nothing else is left on the section: a legacy duplicate would take its place.
  const savedSectionTitle = form.status === "PUBLISHED" && form.visibility === "SITE" && form.siteSectionId
    && findDonationFormsOnSiteSection(donationForms ?? [], form.siteSectionId, form.id).length === 0
    ? donsSectionTitle(form.siteSectionId)
    : null
  const removedSectionTitle = savedSectionTitle && (visibility !== "SITE" || siteSectionId !== form.siteSectionId)
    ? savedSectionTitle
    : null

  const requirementOptions = [
    { value: "REQUIRED", label: tSteps("fields.requirement.required") },
    { value: "OPTIONAL", label: tSteps("fields.requirement.optional") },
    { value: "HIDDEN",   label: tSteps("fields.requirement.hidden") },
  ]

  // window.location.origin read only at click time (not during render) — sidesteps the
  // SSR/hydration-mismatch concern DonShareCard handles with useSyncExternalStore, since
  // this button never displays the URL itself, only copies it.
  // Opens the public page with ?preview=1 — the public GET lets a logged-in manager of this
  // association through the PUBLISHED gate for that flag (src/lib/form-preview.ts), so a
  // draft can be checked before publishing; the page disables submission in that mode.
  function handlePreview() {
    if (!user.associationSlug || !form) return
    window.open(`${BASE_PATH}/${user.associationSlug}/dons/${form.slug}?preview=1`, "_blank", "noopener")
  }

  async function handleCopyLink() {
    if (!user.associationSlug || !form) return
    const url = `${window.location.origin}${BASE_PATH}/${user.associationSlug}/dons/${form.slug}`
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
    payment: tSteps("payment.title"),
    publish: tSteps("publish.title"),
  }

  // Refuses to publish while any step still has unsaved edits (each step has its own Save
  // button, so it is easy to leave one behind) or while no tier is saved. The offending steps
  // are expanded, tinted and named in the toast; the first one is scrolled into view. Only a
  // publish that passes this check goes on to the confirmation dialog.
  function handlePublish() {
    const blockedSteps = STEP_KEYS.filter(stepKey => stepIssue(stepKey) !== null)
    if (blockedSteps.length === 0) {
      setPublishConfirm("publish")
      return
    }
    setPublishAttempted(true)
    setOpenSteps(previousSteps => Array.from(new Set([...previousSteps, ...blockedSteps])))
    const unsavedSteps = blockedSteps.filter(stepKey => stepIssue(stepKey) === "unsaved")
    toast.error(unsavedSteps.length > 0
      ? t("detail.publishBlocked.unsavedToast", { steps: unsavedSteps.map(stepKey => stepTitles[stepKey]).join(", ") })
      : t("detail.publishBlocked.noTiersToast"))
    document.getElementById(`step-${blockedSteps[0]}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // Saves every step that still has unsaved work: the two editors that own their drafts first
  // (each validates and toasts on its own), then one PATCH for the page-level steps. Stops at
  // the first failure and returns false so the caller stays on the page. Those are separate
  // requests, so when one fails after an earlier one went through, the admin is also told that
  // part of the work was saved — same as the Événement page.
  async function saveAll(): Promise<boolean> {
    const committedSteps: StepKey[] = []
    const warnPartialSave = () => { if (committedSteps.length > 0) toast.warning(t("detail.partialSaveWarning")) }

    if (tiersDirty) {
      if (!(await tiersRef.current?.save())) { warnPartialSave(); return false }
      committedSteps.push("tiers")
    }
    if (fieldsDirty) {
      if (!(await fieldsRef.current?.save())) { warnPartialSave(); return false }
      committedSteps.push("fields")
    }
    let payload: SaveableFields = {}
    if (stepDirty.info) {
      const info = await infoPayload()
      if (!info) { warnPartialSave(); return false }
      payload = { ...payload, ...info }
    }
    if (standardFieldsDirty) payload = { ...payload, ...standardFieldsPayload() }
    if (stepDirty.payment)   payload = { ...payload, ...paymentPayload() }
    if (stepDirty.publish) {
      const publish = publishPayload()
      if (!publish) { warnPartialSave(); return false }
      payload = { ...payload, ...publish }
    }
    if (Object.keys(payload).length === 0) return true
    try {
      await saveMutation.mutateAsync(payload) // its onError has already toasted on failure
      if (stepDirty.info) clearPendingUploads()
      return true
    } catch {
      warnPartialSave()
      return false
    }
  }

  async function handleSaveAndLeave() {
    setLeaveSaving(true)
    try {
      if (await saveAll()) router.push("/dashboard/dons")
    } finally {
      setLeaveSaving(false)
    }
  }

  // Tint + inline tag on a step that blocked the last publish attempt. A plain background on
  // the item (no border, no badge) keeps the accordion reading as one surface.
  const stepClass = (stepKey: StepKey) =>
    cn(
      "overflow-hidden rounded-lg border bg-card",
      publishAttempted && stepIssue(stepKey) && "bg-destructive/10",
    )
  // A flagged step keeps the transparent header so the item's destructive tint and tag stay
  // legible.
  const stepHeaderClass = (stepKey: StepKey) =>
    publishAttempted && stepIssue(stepKey)
      ? undefined
      : "bg-muted hover:bg-muted/80"
  function stepTrigger(stepKey: StepKey) {
    const issue = publishAttempted ? stepIssue(stepKey) : null
    return (
      <span className="flex items-center gap-2">
        {stepTitles[stepKey]}
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
        href="/dashboard/dons"
        onClick={event => { if (isDirty) { event.preventDefault(); setLeaveConfirm(true) } }}
      >
        {t("detail.backToList")}
      </BackLink>

      <PageHeader
        title={form.title}
        description={<Badge variant={STATUS_VARIANT[form.status]}>{STATUS_LABEL[form.status]}</Badge>}
        action={
          <div className="flex gap-2">
            {form.status !== "PUBLISHED" ? (
              <Button size="sm" variant="secondary" onClick={handlePublish} loading={publishMutation.isPending}>
                <CloudArrowUpIcon className="mr-1.5 size-4" />
                {t("detail.publishButton")}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setPublishConfirm("unpublish")} loading={publishMutation.isPending}>
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
              <Button size="sm" variant="ghost" onClick={() => setArchiveConfirm("archive")}>
                <ArchiveIcon className="mr-1.5 size-4" />
                {t("detail.archiveButton")}
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              <TrashIcon className="mr-1.5 size-4" />
              {t("detail.deleteButton")}
            </Button>
          </div>
        }
      />

      {/* keepMounted: Base UI unmounts a closed panel by default, which threw away whatever
          the Paliers / Champs editors held in local state the moment you collapsed them. */}
      {/* Detached steps: the shared joined-container chrome moves onto each item instead. */}
      <Accordion multiple value={openSteps} onValueChange={openValues => setOpenSteps(openValues as StepKey[])} keepMounted className="space-y-3 rounded-none border-0 bg-transparent divide-y-0">
        <AccordionItem id="step-info" value="info" className={stepClass("info")}>
          <AccordionTrigger className={stepHeaderClass("info")}>{stepTrigger("info")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-4">
              {/* Part of this step's Save rather than saved on blur — blur also fired when
                  clicking the back link, so "leave without saving" still saved the title. */}
              <div className="max-w-xl space-y-1.5">
                <Label htmlFor="form-title">{t("detail.titleLabel")}</Label>
                <Input
                  id="form-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{tSteps("info.imageLabel")}</Label>
                <ImageUpload
                  value={imageUrl}
                  onChange={(url) => { if (url === "") setPendingFile(null); setImageUrl(url) }}
                  prefix="adhera/dons"
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
                  prefix="adhera/dons"
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
                <p className="flex items-center gap-1.5 text-sm font-semibold">
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
            <DonationTiersEditor ref={tiersRef} formId={id} onDirtyChange={setTiersDirty} />
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-fields" value="fields" className={stepClass("fields")}>
          <AccordionTrigger className={stepHeaderClass("fields")}>{stepTrigger("fields")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium">{tSteps("fields.standardFieldsHint")}</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField label={tSteps("fields.addressLabel")} options={requirementOptions} value={fieldAddress} onValueChange={v => setFieldAddress(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.birthDateLabel")} options={requirementOptions} value={fieldBirthDate} onValueChange={v => setFieldBirthDate(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.phoneLabel")} options={requirementOptions} value={fieldPhone} onValueChange={v => setFieldPhone(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.mobileLabel")} options={requirementOptions} value={fieldMobile} onValueChange={v => setFieldMobile(v as FieldRequirement)} />
                  <SelectField label={tSteps("fields.genderLabel")} options={requirementOptions} value={fieldGender} onValueChange={v => setFieldGender(v as FieldRequirement)} />
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
                <DonationFormFieldsEditor ref={fieldsRef} formId={id} onDirtyChange={setFieldsDirty} />
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem id="step-payment" value="payment" className={stepClass("payment")}>
          <AccordionTrigger className={stepHeaderClass("payment")}>{stepTrigger("payment")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-3">
              <CheckboxField
                label={tSteps("payment.allowOnlineLabel")}
                checked={allowOnline}
                onChange={(e) => setAllowOnline(e.target.checked)}
              />
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
              <div className="space-y-1.5">
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
                {removedSectionTitle && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {tSteps("publish.siteSectionRemovedWarning", { section: removedSectionTitle })}
                  </p>
                )}
              </div>
              {visibility === "SITE" && (
                <div className="space-y-1.5">
                  <SelectField
                    label={tSteps("publish.siteSectionLabel")}
                    required
                    disabled={creatingSection}
                    placeholder={tSteps("publish.siteSectionPlaceholder")}
                    options={[
                      ...donsSiteSections.map(s => ({ value: s.id, label: s.title || SECTION_LABELS.dons })),
                      { value: CREATE_SITE_SECTION_VALUE, label: tSteps("publish.siteSectionCreateOption") },
                    ]}
                    value={siteSectionId}
                    onValueChange={v => {
                      if (v === CREATE_SITE_SECTION_VALUE) createDonsSection()
                      else setSiteSectionId(v)
                    }}
                  />
                  {formOnPickedSection && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {form.status === "PUBLISHED"
                        ? tSteps("publish.siteSectionReplaceWarningPublished", { title: formOnPickedSection.title })
                        : tSteps("publish.siteSectionReplaceWarningDraft", { title: formOnPickedSection.title })}
                    </p>
                  )}
                </div>
              )}
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
            <Button variant="destructive" onClick={() => router.push("/dashboard/dons")} disabled={leaveSaving}>
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

      <ConfirmDialog
        open={!!archiveConfirm}
        onOpenChange={(open) => { if (!open) setArchiveConfirm(null) }}
        title={archiveConfirm === "deleteBlocked" ? t("formsView.deleteBlocked.title") : t("formsView.archiveConfirm.title")}
        description={(archiveConfirm === "deleteBlocked"
          ? t("formsView.deleteBlocked.description", { title: form.title })
          : t("formsView.archiveConfirm.description", { title: form.title })) + recurringNote}
        confirmLabel={t("formsView.archiveConfirm.confirmLabel")}
        confirmVariant="default"
        loading={archivePending}
        onConfirm={() => publishMutation.mutate("archive", { onSuccess: () => setArchiveConfirm(null) })}
      />

      <Modal
        open={deleteBlockedInfo}
        onOpenChange={setDeleteBlockedInfo}
        title={t("formsView.deleteBlocked.title")}
        description={t("formsView.deleteBlocked.descriptionArchived", { title: form.title })}
        size="sm"
        footer={
          <Button variant="outline" onClick={() => setDeleteBlockedInfo(false)}>
            {tCommon("close")}
          </Button>
        }
      />

      <ConfirmDialog
        open={!!publishConfirm}
        onOpenChange={(o) => { if (!o) setPublishConfirm(null) }}
        title={publishConfirm === "publish" ? t("formsView.publishConfirm.title") : t("formsView.unpublishConfirm.title")}
        description={publishConfirm === "publish"
          ? publishConfirmDescription({
              form,
              forms:                donationForms,
              sections:             siteConfigData?.config?.sections ?? [],
              donsModuleEnabled:    modules.dons,
              fallbackSectionTitle: SECTION_LABELS.dons,
              translate:            t,
            })
          : t("formsView.unpublishConfirm.description")}
        confirmLabel={publishConfirm === "publish" ? t("formsView.publishConfirm.confirmLabel") : t("formsView.unpublishConfirm.confirmLabel")}
        confirmVariant="default"
        loading={publishMutation.isPending}
        onConfirm={() => {
          if (publishConfirm) publishMutation.mutate(publishConfirm)
          setPublishConfirm(null)
        }}
      />
    </div>
  )
}
