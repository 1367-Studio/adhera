"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  CopyIcon, ArchiveIcon, TrashIcon, CloudArrowUpIcon, CloudArrowDownIcon,
} from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { ImageUpload } from "@/components/ui/image-upload"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DonationFormFieldsEditor } from "@/components/dons/donation-form-fields-editor"
import { DonationTiersEditor } from "@/components/dons/donation-tiers-editor"

type DonationFormStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"
type FieldRequirement   = "HIDDEN" | "OPTIONAL" | "REQUIRED"
type Visibility         = "LINK" | "SITE" | "PRIVATE"

type DonationForm = {
  id:     string
  title:  string
  slug:   string
  status: DonationFormStatus
  _count: { dons: number; subscriptions: number }

  imageUrl:             string | null
  description:          string | null
  conditions:            string | null
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

  visibility: Visibility
  opensAt:    string | null
  closesAt:   string | null
}

type SaveableFields = Partial<Omit<DonationForm, "id" | "slug" | "status" | "_count">>

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

  const [title, setTitle]                 = useState("")
  const [deleteConfirm, setDeleteConfirm]  = useState(false)

  // Step 1 — Informations générales
  const [imageUrl, setImageUrl]         = useState("")
  const [description, setDescription]   = useState("")
  const [conditions, setConditions]     = useState("")
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
  const [visibility, setVisibility] = useState<Visibility>("LINK")
  const [opensAt, setOpensAt]       = useState("")
  const [closesAt, setClosesAt]     = useState("")

  const { data: form, isLoading, isError } = useQuery<DonationForm>({
    queryKey: ["donation-form", id],
    queryFn:  () => fetch(`/api/donation-forms/${id}`).then(r => {
      if (!r.ok) throw new Error("not found")
      return r.json()
    }),
  })

  useEffect(() => {
    if (!form) return
    setTitle(form.title)
    setImageUrl(form.imageUrl ?? "")
    setDescription(form.description ?? "")
    setConditions(form.conditions ?? "")
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

  // Uploads the pending image file (if any) before saving — mirrors evenement-form.tsx's
  // handleFormSubmit so a cancelled edit never leaves an orphaned file in R2.
  async function handleSaveInfo() {
    let resolvedImageUrl = imageUrl || null
    if (pendingFile) {
      setUploadingImage(true)
      try {
        const fd = new FormData()
        fd.append("file", pendingFile.file)
        fd.append("prefix", "adhera/dons")
        const res = await fetch("/api/upload", { method: "POST", body: fd })
        if (!res.ok) { toast.error(t("detail.toasts.saveError")); return }
        const { url } = (await res.json()) as { url: string }
        resolvedImageUrl = url
      } finally {
        setUploadingImage(false)
      }
    }
    saveMutation.mutate({
      imageUrl: resolvedImageUrl,
      description: description || null,
      conditions: conditions || null,
      requireCguvSignature: requireCguv,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
    })
    setPendingFile(null)
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
      qc.invalidateQueries({ queryKey: ["donation-forms"] })
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
  const canDelete = form._count.dons === 0 && form._count.subscriptions === 0

  const requirementOptions = [
    { value: "HIDDEN",   label: tSteps("fields.requirement.hidden") },
    { value: "OPTIONAL", label: tSteps("fields.requirement.optional") },
    { value: "REQUIRED", label: tSteps("fields.requirement.required") },
  ]

  return (
    <div className="space-y-4">
      <BackLink href="/dashboard/dons">{t("detail.backToList")}</BackLink>

      <PageHeader
        title={form.title}
        description={<Badge variant={STATUS_VARIANT[form.status]}>{STATUS_LABEL[form.status]}</Badge>}
        action={
          <div className="flex gap-2">
            {form.status !== "PUBLISHED" ? (
              <Button size="sm" variant="secondary" onClick={() => publishMutation.mutate("publish")} loading={publishMutation.isPending}>
                <CloudArrowUpIcon className="mr-1.5 size-4" />
                {t("detail.publishButton")}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => publishMutation.mutate("unpublish")} loading={publishMutation.isPending}>
                <CloudArrowDownIcon className="mr-1.5 size-4" />
                {t("detail.unpublishButton")}
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
            <Button size="sm" variant="ghost" disabled={!canDelete} onClick={() => setDeleteConfirm(true)}>
              <TrashIcon className="mr-1.5 size-4" />
              {t("detail.deleteButton")}
            </Button>
          </div>
        }
      />

      <div className="max-w-xl space-y-2">
        <Label htmlFor="form-title">{t("detail.titleLabel")}</Label>
        <Input
          id="form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title.trim() !== form.title) saveMutation.mutate({ title: title.trim() }) }}
        />
      </div>

      <Accordion multiple defaultValue={[]}>
        <AccordionItem value="info">
          <AccordionTrigger>{tSteps("info.title")}</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-4">
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
              <CheckboxField
                label={tSteps("info.requireCguvLabel")}
                checked={requireCguv}
                onChange={(e) => setRequireCguv(e.target.checked)}
              />
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
              <div className="flex justify-end">
                <Button
                  size="sm"
                  loading={saveMutation.isPending || uploadingImage}
                  onClick={handleSaveInfo}
                >
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem value="tiers">
          <AccordionTrigger>{tSteps("tiers.title")}</AccordionTrigger>
          <AccordionPanel>
            <DonationTiersEditor formId={id} />
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem value="fields">
          <AccordionTrigger>{tSteps("fields.title")}</AccordionTrigger>
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
                    loading={saveMutation.isPending}
                    onClick={() => saveMutation.mutate({
                      fieldAddress, fieldBirthDate, fieldPhone, fieldMobile, fieldGender,
                    })}
                  >
                    {tCommon("save")}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4">
                <DonationFormFieldsEditor formId={id} />
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem value="payment">
          <AccordionTrigger>{tSteps("payment.title")}</AccordionTrigger>
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
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({
                    allowOnline, allowCash, allowCheque, allowTransfer,
                    offlineInstructions: offlineInstructions || null,
                  })}
                >
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem value="publish">
          <AccordionTrigger>{tSteps("publish.title")}</AccordionTrigger>
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label={tSteps("publish.opensAtLabel")}
                  type="datetime-local"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                />
                <FormField
                  label={tSteps("publish.closesAtLabel")}
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  loading={saveMutation.isPending}
                  onClick={() => {
                    if (opensAt && closesAt && opensAt >= closesAt) {
                      toast.error(tSteps("publish.datesOrderError"))
                      return
                    }
                    saveMutation.mutate({
                      visibility,
                      opensAt: fromDatetimeLocal(opensAt),
                      closesAt: fromDatetimeLocal(closesAt),
                    })
                  }}
                >
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

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
