"use client"

import { Suspense, useState, useRef, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  DownloadSimpleIcon, HandshakeIcon, UsersIcon, TrendUpIcon, PlusIcon,
  FileTextIcon, ReceiptIcon, NotePencilIcon, CopyIcon, ArchiveIcon,
  CloudArrowUpIcon, CloudArrowDownIcon, TrashIcon, LinkIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useCurrentUser } from "@/lib/user-context"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import { cn } from "@/lib/utils"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BASE_PATH } from "@/lib/env"
import { DonShareCard } from "@/components/dons/don-share-card"

type DonationForm = {
  id:          string
  title:       string
  slug:        string
  status:      "DRAFT" | "PUBLISHED" | "ARCHIVED"
  imageUrl:    string | null
  createdAt:   string
  totalAmount: number
  _count:      { dons: number; subscriptions: number }
}

type Don = {
  id:            string
  donorType:     "INDIVIDUAL" | "COMPANY"
  firstName:     string
  lastName:      string
  companyName:   string | null
  email:         string
  amount:        string
  message:       string | null
  anonymous:     boolean
  paidAt:        string | null
  receiptNumber: string | null
  receiptMode:   "NONE" | "FULL" | "PARTIAL" | null
  deductibleAmount: string | null
  paymentMethod: "STRIPE" | "ESPECES" | "CHEQUE" | "VIREMENT" | null
  donationForm:  { id: string; title: string } | null
}

type DonsResult = {
  data:        Don[]
  total:       number
  page:        number
  limit:       number
  totalPages:  number
  totalAmount: number
  totalCount:  number
}

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)
const PAGE_SIZE   = 25

type Tab = "formulaires" | "dons" | "recus"

export default function DonsPage() {
  return (
    <Suspense fallback={null}>
      <DonsPageInner />
    </Suspense>
  )
}

function DonsPageInner() {
  const router       = useRouter()
  const qc           = useQueryClient()
  const searchParams = useSearchParams()
  const t            = useTranslations("donationForms")
  const tCommon      = useTranslations("common")
  const user         = useCurrentUser()

  // Same "read origin at click time" reasoning as the copy-link button on the form's own
  // detail page — no need for the SSR-safe useSyncExternalStore dance DonShareCard uses,
  // since this action never displays the URL, only copies it.
  async function handleCopyFormLink(f: Pick<DonationForm, "slug">) {
    if (!user.associationSlug) return
    const url = `${window.location.origin}${BASE_PATH}/${user.associationSlug}/dons/${f.slug}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t("detail.toasts.linkCopied"))
    } catch {
      toast.error(t("detail.toasts.linkCopyError"))
    }
  }

  const initialTab = (searchParams.get("tab") as Tab) ?? "formulaires"
  const [tab, setTab] = useState<Tab>(["formulaires", "dons", "recus"].includes(initialTab) ? initialTab : "formulaires")

  const [page, setPage]               = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch]           = useState("")
  const [yearFilter, setYearFilter]   = useState<number>(currentYear)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  // ─── Formulaires ────────────────────────────────────────────────────────
  const [newFormOpen, setNewFormOpen]   = useState(false)
  const [newFormTitle, setNewFormTitle] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<DonationForm | null>(null)

  const { data: forms = [], isLoading: loadingForms } = useQuery<DonationForm[]>({
    queryKey:  ["donation-forms"],
    queryFn:   () => fetch("/api/donation-forms").then(r => r.json()),
    enabled:   tab === "formulaires",
    staleTime: 0,
  })

  const createFormMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch("/api/donation-forms", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.createError"))
      return res.json() as Promise<DonationForm>
    },
    onSuccess: (form) => {
      qc.invalidateQueries({ queryKey: ["donation-forms"] })
      toast.success(t("formsView.toasts.created"))
      setNewFormOpen(false)
      setNewFormTitle("")
      router.push(`/dashboard/dons/${form.id}`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.createError")),
  })

  const publishMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "publish" | "unpublish" | "archive" | "duplicate" }) => {
      const res = await fetch(`/api/donation-forms/${id}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.statusError"))
      return res.json() as Promise<DonationForm>
    },
    onSuccess: (_form, variables) => {
      qc.invalidateQueries({ queryKey: ["donation-forms"] })
      toast.success(variables.action === "duplicate" ? t("formsView.toasts.duplicated") : t("formsView.toasts.statusUpdated"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.statusError")),
  })

  const deleteFormMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/donation-forms/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.deleteError"))
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["donation-forms"] }); toast.success(t("formsView.toasts.deleted")) },
    onError:   (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.deleteError")),
  })

  const FORM_STATUS_LABEL  = { DRAFT: t("formStatus.draft"), PUBLISHED: t("formStatus.published"), ARCHIVED: t("formStatus.archived") }
  const FORM_STATUS_VARIANT: Record<DonationForm["status"], "secondary" | "default" | "outline"> = {
    DRAFT: "secondary", PUBLISHED: "default", ARCHIVED: "outline",
  }

  // ─── Dons reçus ─────────────────────────────────────────────────────────
  const donsParams = new URLSearchParams({
    page:  String(page),
    limit: String(PAGE_SIZE),
    year:  String(yearFilter),
    ...(search ? { search } : {}),
  })

  const { data: donsResult, isLoading: loadingDons } = useQuery<DonsResult>({
    queryKey:  ["dashboard-dons", page, yearFilter, search],
    queryFn:   () => fetch(`/api/dons?${donsParams}`).then(r => r.json()),
    enabled:   tab === "dons",
    staleTime: 0,
  })

  // Fetch-and-save instead of window.open(url, "_blank") — a non-2xx response (association
  // hasn't enabled fiscal receipts, don introuvable, etc.) used to just open a new tab
  // showing raw {"error":"..."} JSON instead of any legible feedback.
  async function downloadRecu(donId: string) {
    try {
      const res = await fetch(`${BASE_PATH}/api/dons/${donId}/recu`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(body?.error ?? tCommon("error"))
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `recu-fiscal-${donId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(tCommon("error"))
    }
  }

  const dons = donsResult?.data ?? []

  // ─── Dons hors ligne en attente d'encaissement ─────────────────────────
  const [pendingPage, setPendingPage] = useState(1)
  const PENDING_PAGE_SIZE = 25

  const { data: pendingResult, isLoading: loadingPending } = useQuery<DonsResult>({
    queryKey:  ["dashboard-dons-pending", pendingPage],
    queryFn:   () => fetch(`/api/dons?pendingOnly=true&page=${pendingPage}&limit=${PENDING_PAGE_SIZE}`).then(r => r.json()),
    enabled:   tab === "dons",
    staleTime: 0,
  })
  const pendingDons = pendingResult?.data ?? []

  const encaisserMutation = useMutation({
    mutationFn: async (donId: string) => {
      const res = await fetch(`/api/dons/${donId}/encaisser`, { method: "POST" })
      if (!res.ok) throw new Error((await res.json()).error ?? tCommon("error"))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-dons-pending"] })
      qc.invalidateQueries({ queryKey: ["dashboard-dons"] })
      toast.success(t("donationsView.toasts.encaisse"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const PAYMENT_METHOD_LABEL: Record<string, string> = {
    ESPECES:  t("donationsView.paymentMethod.especes"),
    CHEQUE:   t("donationsView.paymentMethod.cheque"),
    VIREMENT: t("donationsView.paymentMethod.virement"),
  }

  const pendingColumns: Column<Don>[] = [
    {
      key:    "donor",
      header: t("donationsView.columns.donor"),
      cell: (d) => (
        <div>
          <p className="font-medium">{d.donorType === "COMPANY" ? (d.companyName ?? `${d.firstName} ${d.lastName}`) : `${d.firstName} ${d.lastName}`}</p>
          <p className="text-xs text-muted-foreground">{d.email}</p>
        </div>
      ),
    },
    {
      key:    "method",
      header: t("donationsView.columns.method"),
      className: "w-32",
      cell: (d) => <Badge variant="secondary">{d.paymentMethod ? PAYMENT_METHOD_LABEL[d.paymentMethod] : "—"}</Badge>,
    },
    {
      key:       "amount",
      header:    t("donationsView.columns.amount"),
      className: "w-28 text-right",
      cell: (d) => (
        <span className="font-semibold tabular-nums">
          {parseFloat(d.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key:       "actions",
      header:    "",
      className: "w-40",
      cell: (d) => (
        <Button
          size="sm"
          variant="secondary"
          loading={encaisserMutation.isPending && encaisserMutation.variables === d.id}
          disabled={encaisserMutation.isPending && encaisserMutation.variables !== d.id}
          onClick={() => encaisserMutation.mutate(d.id)}
        >
          {t("donationsView.encaisserButton")}
        </Button>
      ),
    },
  ]

  const donColumns: Column<Don>[] = [
    {
      key:    "donor",
      header: t("donationsView.columns.donor"),
      cell: (d) => (
          <div>
            <p className="font-medium flex items-center gap-1.5">
              {d.donorType === "COMPANY" ? (d.companyName ?? `${d.firstName} ${d.lastName}`) : `${d.firstName} ${d.lastName}`}
              {d.donorType === "COMPANY" && <Badge variant="secondary">Entreprise</Badge>}
              {d.anonymous && <Badge variant="outline">Anonyme</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">{d.email}</p>
          </div>
      ),
    },
    {
      key:    "form",
      header: t("donationsView.columns.form"),
      cell: (d) => d.donationForm
        ? <span className="text-sm">{d.donationForm.title}</span>
        : <span className="text-sm text-muted-foreground italic">{t("donationsView.columns.standalone")}</span>,
    },
    {
      key:    "message",
      header: t("donationsView.columns.message"),
      cell: (d) => d.message
        ? <p className="text-sm text-muted-foreground italic truncate max-w-xs">« {d.message} »</p>
        : <span className="text-muted-foreground/40">—</span>,
    },
    {
      key:       "paidAt",
      header:    t("donationsView.columns.date"),
      className: "w-28",
      cell: (d) => d.paidAt ? format(new Date(d.paidAt), "dd/MM/yyyy", { locale: fr }) : <span className="text-muted-foreground">—</span>,
    },
    {
      key:       "amount",
      header:    t("donationsView.columns.amount"),
      className: "w-28 text-right",
      cell: (d) => (
        <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">
          +{parseFloat(d.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key:       "receipt",
      header:    "",
      className: "w-10",
      // receiptMode "NONE" never has a receipt to fetch — same dead-end click as clicking
      // it for a form configured not to issue one. Every other case (including null, the
      // standalone /portal/[slug]/don page) still shows the button; downloadRecu's own
      // error toast covers the remaining reasons a receipt might not be available
      // (fiscal receipts not enabled for the association, etc).
      cell: (d) => d.paidAt && d.receiptMode !== "NONE" ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => downloadRecu(d.id)}
          title={d.receiptMode === "PARTIAL" && d.deductibleAmount
            ? `Générer le reçu fiscal (partiel : ${parseFloat(d.deductibleAmount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} déductible)`
            : "Générer le reçu fiscal"}
        >
          <DownloadSimpleIcon className="size-3.5" />
        </Button>
      ) : null,
    },
  ]

  const totalAmount = donsResult?.totalAmount ?? 0
  const totalCount  = donsResult?.totalCount ?? 0
  const avgAmount   = totalCount > 0 ? totalAmount / totalCount : 0

  // ─── Reçus fiscaux ──────────────────────────────────────────────────────
  const recusParams = new URLSearchParams({
    page:  "1",
    limit: "100",
    year:  String(yearFilter),
    receiptsOnly: "true",
  })

  const { data: recusResult, isLoading: loadingRecus } = useQuery<DonsResult>({
    queryKey:  ["dashboard-dons-recus", yearFilter],
    queryFn:   () => fetch(`/api/dons?${recusParams}`).then(r => r.json()),
    enabled:   tab === "recus",
    staleTime: 0,
  })

  const recus = recusResult?.data ?? []

  const recuColumns: Column<Don>[] = [
    {
      key:    "receiptNumber",
      header: t("receiptsView.columns.receiptNumber"),
      className: "w-28 font-mono text-xs",
      cell: (d) => d.receiptNumber,
    },
    {
      key:    "donor",
      header: t("receiptsView.columns.donor"),
      cell: (d) => (
        <div>
          <p className="font-medium">{d.donorType === "COMPANY" ? (d.companyName ?? `${d.firstName} ${d.lastName}`) : `${d.firstName} ${d.lastName}`}</p>
          <p className="text-xs text-muted-foreground">{d.email}</p>
        </div>
      ),
    },
    {
      key:       "issuedAt",
      header:    t("receiptsView.columns.issuedAt"),
      className: "w-28",
      cell: (d) => d.paidAt ? format(new Date(d.paidAt), "dd/MM/yyyy", { locale: fr }) : "—",
    },
    {
      key:       "amount",
      header:    t("receiptsView.columns.amount"),
      className: "w-28 text-right",
      cell: (d) => (
        <span className="font-semibold tabular-nums">
          {parseFloat(d.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      key:       "download",
      header:    "",
      className: "w-10",
      cell: (d) => (
        <Button size="icon-sm" variant="ghost" onClick={() => downloadRecu(d.id)} title="Télécharger le reçu">
          <DownloadSimpleIcon className="size-3.5" />
        </Button>
      ),
    },
  ]

  function changeTab(next: Tab) {
    setTab(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", next)
    router.replace(`/dashboard/dons?${params}`, { scroll: false })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={tab === "formulaires" ? (
          <Button size="sm" onClick={() => setNewFormOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("newForm")}
          </Button>
        ) : undefined}
      />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)}>
        <TabsList>
          {([
            { key: "formulaires", label: t("tabs.forms"),     icon: FileTextIcon },
            { key: "dons",        label: t("tabs.donations"), icon: HandshakeIcon },
            { key: "recus",       label: t("tabs.receipts"),  icon: ReceiptIcon },
          ] as const).map(tabOption => (
            <TabsTrigger key={tabOption.key} value={tabOption.key} className="px-4">
              <tabOption.icon className="size-3.5" />
              {tabOption.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "formulaires" && (
        loadingForms ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-card overflow-hidden animate-pulse">
                <div className="aspect-[3/1] bg-muted" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : forms.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("formsView.noForms")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {forms.map(f => (
              <div key={f.id} className="group rounded-lg border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/dons/${f.id}`)}
                  className="block w-full text-left"
                >
                  {f.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.imageUrl} alt="" className="aspect-[3/1] w-full object-cover bg-muted" />
                  ) : (
                    <div className="aspect-[3/1] w-full bg-muted flex items-center justify-center">
                      <HandshakeIcon className="size-6 text-muted-foreground" />
                    </div>
                  )}
                </button>
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/dons/${f.id}`)}
                      className="min-w-0 text-left hover:underline decoration-muted-foreground/40 underline-offset-2"
                    >
                      <p className="font-medium truncate">{f.title}</p>
                      <p className="text-xs text-muted-foreground truncate">/{f.slug}</p>
                    </button>
                    <RowActions
                      actions={[
                        { label: t("formsView.actions.edit"), icon: <NotePencilIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/dons/${f.id}`) },
                        { label: t("formsView.actions.duplicate"), icon: <CopyIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "duplicate" }) },
                        ...(f.status === "PUBLISHED"
                          ? [{ label: t("detail.copyLinkButton"), icon: <LinkIcon className="size-3.5" />, onClick: () => handleCopyFormLink(f) }]
                          : []),
                        ...(f.status !== "PUBLISHED"
                          ? [{ label: t("formsView.actions.publish"), icon: <CloudArrowUpIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "publish" }) }]
                          : [{ label: t("formsView.actions.unpublish"), icon: <CloudArrowDownIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "unpublish" }) }]),
                        ...(f.status !== "ARCHIVED"
                          ? [{ label: t("formsView.actions.archive"), icon: <ArchiveIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "archive" }) }]
                          : []),
                        {
                          label:       t("formsView.actions.delete"),
                          icon:        <TrashIcon className="size-3.5" />,
                          onClick:     () => setDeleteTarget(f),
                          destructive: true,
                          separator:   true,
                          disabled:    f._count.dons > 0 || f._count.subscriptions > 0,
                        },
                      ]}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge variant={FORM_STATUS_VARIANT[f.status]}>{FORM_STATUS_LABEL[f.status]}</Badge>
                    <span className="text-xs text-muted-foreground">{format(new Date(f.createdAt), "dd/MM/yyyy", { locale: fr })}</span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3 text-sm">
                    <span className="text-muted-foreground">{f._count.dons} {t("formsView.columns.donors").toLowerCase()}</span>
                    <span className="font-semibold tabular-nums">
                      {f.totalAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "dons" && (
        <>
          {/* Gated on the total count, not this page's rows — otherwise paging to an
              empty last page (e.g. right after encaissing the only item on it) would hide
              the whole section instead of just showing an empty table. */}
          {!!pendingResult?.total && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("donationsView.pendingTitle")}</p>
              <DataTable
                columns={pendingColumns}
                data={pendingDons}
                loading={loadingPending}
                keyExtractor={(d) => d.id}
                empty=""
                pagination={pendingResult ? {
                  page:         pendingResult.page,
                  totalPages:   pendingResult.totalPages,
                  total:        pendingResult.total,
                  limit:        pendingResult.limit,
                  onPageChange: (p) => setPendingPage(p),
                } : undefined}
              />
            </div>
          )}

          <DonShareCard />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TrendUpIcon className="size-3.5" />
                {t("donationsView.totalLabel", { year: yearFilter })}
              </div>
              <p className={cn("text-xl font-bold", totalAmount > 0 ? "text-green-600 dark:text-green-400" : "")}>
                {totalAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <UsersIcon className="size-3.5" />
                {t("donationsView.donorsLabel")}
              </div>
              <p className="text-xl font-bold">{totalCount}</p>
            </div>
            <div className="rounded-lg border bg-card p-4 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <HandshakeIcon className="size-3.5" />
                {t("donationsView.averageLabel")}
              </div>
              <p className="text-xl font-bold">
                {avgAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <SearchInput
              value={searchInput}
              onValueChange={handleSearch}
              onClear={() => { setSearchInput(""); setSearch(""); setPage(1) }}
              placeholder="Rechercher…"
              containerClassName="w-60"
            />
            <Select value={String(yearFilter)} onValueChange={v => { if (v) { setYearFilter(parseInt(v)); setPage(1) } }}>
              <SelectTrigger className="w-36"><SelectValue>{String(yearFilter)}</SelectValue></SelectTrigger>
              <SelectContent>
                {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{String(y)}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="self-center text-sm text-muted-foreground">
              {donsResult?.total ?? 0} don{(donsResult?.total ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>

          <DataTable
            columns={donColumns}
            data={dons}
            loading={loadingDons}
            keyExtractor={(d) => d.id}
            empty={t("donationsView.noDonations")}
            pagination={donsResult ? {
              page:         donsResult.page,
              totalPages:   donsResult.totalPages,
              total:        donsResult.total,
              limit:        donsResult.limit,
              onPageChange: (p) => setPage(p),
            } : undefined}
          />
        </>
      )}

      {tab === "recus" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Select value={String(yearFilter)} onValueChange={v => { if (v) setYearFilter(parseInt(v)) }}>
              <SelectTrigger className="w-36"><SelectValue>{String(yearFilter)}</SelectValue></SelectTrigger>
              <SelectContent>
                {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{String(y)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DataTable
            columns={recuColumns}
            data={recus}
            loading={loadingRecus}
            keyExtractor={(d) => d.id}
            empty={t("receiptsView.noReceipts")}
          />
        </>
      )}

      {/* New form modal */}
      <Modal
        open={newFormOpen}
        onOpenChange={(o) => { if (!o) { setNewFormOpen(false); setNewFormTitle("") } }}
        title={t("newFormModal.title")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setNewFormOpen(false)}>{tCommon("cancel")}</Button>
            <Button
              loading={createFormMutation.isPending}
              disabled={!newFormTitle.trim()}
              onClick={() => createFormMutation.mutate(newFormTitle.trim())}
            >
              {t("newFormModal.createButton")}
            </Button>
          </>
        }
      >
        <div className="space-y-2 py-1">
          <Label htmlFor="new-form-title">{t("newFormModal.titleLabel")}</Label>
          <Input
            id="new-form-title"
            value={newFormTitle}
            onChange={(e) => setNewFormTitle(e.target.value)}
            placeholder={t("newFormModal.titlePlaceholder")}
            autoFocus
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title={t("formsView.deleteTitle")}
        description={t("formsView.deleteDescription", { title: deleteTarget?.title ?? "" })}
        confirmLabel={tCommon("delete")}
        loading={deleteFormMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteFormMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
