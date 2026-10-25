"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { DownloadSimpleIcon, FunnelXIcon } from "@phosphor-icons/react/dist/ssr"
import { EvenementBilanPanel } from "@/components/evenements/evenement-bilan-panel"
import { EvenementStatusBadge } from "@/components/evenements/evenement-status-badge"
import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { PageHeader } from "@/components/ui/page-header"
import { SearchInput } from "@/components/ui/search-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StarRatingDisplay } from "@/components/ui/star-rating"
import { useEvenementBilanParticipants } from "@/hooks/use-evenements"
import { buildCsv, downloadCsv, type CsvCell } from "@/lib/csv"
import type { BilanParticipantRow, BilanPaymentStatus } from "@/lib/evenement-bilan"
import type { EvenementPaymentMethod } from "@prisma/client"

type PresenceFilter = "all" | "present" | "absent"
type ReviewFilter   = "all" | "with" | "without"

const PAYMENT_STATUS_VARIANT: Record<BilanPaymentStatus, "success" | "warning" | "outline" | "secondary"> = {
  PAID: "success", PENDING: "warning", REFUNDED: "outline", FREE: "secondary",
}

// Same labels as the public registration form's payment method picker.
const PAYMENT_METHOD_LABEL_KEY: Record<EvenementPaymentMethod, "paymentMethodStripe" | "paymentMethodCash" | "paymentMethodCheque" | "paymentMethodTransfer"> = {
  STRIPE: "paymentMethodStripe", ESPECES: "paymentMethodCash", CHEQUE: "paymentMethodCheque", VIREMENT: "paymentMethodTransfer",
}

const EURO_FORMAT   = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })
// CSV amounts stay plain numbers (« 30,00 ») so French Excel sums them; the currency is in the header.
const CSV_AMOUNT_FORMAT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

function formatEuroCents(amountCents: number) {
  return EURO_FORMAT.format(amountCents / 100)
}

// A free seat, or one that never moved money, shows « — » rather than « 0,00 € ».
function displayedAmountCents(row: BilanParticipantRow): number | null {
  return row.paymentStatus === "FREE" ? null : row.collectedCents
}

function normalizeForSearch(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr")
}

export function EvenementBilanView() {
  const t       = useTranslations("evenements.bilanPage")
  const tBilan  = useTranslations("evenements.view.bilan")
  const tRoot   = useTranslations()
  const { id: evenementId } = useParams<{ id: string }>()

  const { data, isLoading } = useEvenementBilanParticipants(evenementId)

  const [searchText, setSearchText]         = useState("")
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>("all")
  const [reviewFilter, setReviewFilter]     = useState<ReviewFilter>("all")
  const hasActiveFilters = !!searchText || presenceFilter !== "all" || reviewFilter !== "all"

  const participants = useMemo(() => data?.participants ?? [], [data])

  // Client-side: the list is one event's participants, already loaded — so the search applies
  // from the first character, accent- and case-insensitive.
  const filteredParticipants = useMemo(() => {
    const normalizedSearch = normalizeForSearch(searchText.trim())
    return participants.filter(row => {
      if (presenceFilter === "present" && !row.present) return false
      if (presenceFilter === "absent" && row.present) return false
      if (reviewFilter === "with" && !row.review) return false
      if (reviewFilter === "without" && row.review) return false
      if (!normalizedSearch) return true
      return normalizeForSearch(`${row.firstName} ${row.lastName} ${row.email ?? ""}`).includes(normalizedSearch)
    })
  }, [participants, searchText, presenceFilter, reviewFilter])

  if (isLoading) return <DetailLoadingSkeleton />

  if (!data) {
    return (
      <DetailNotFound
        message={tRoot("evenements.presences.notFound.message")}
        backHref="/dashboard/evenements"
        backLabel={tRoot("evenements.presences.notFound.backLabel")}
      />
    )
  }

  const { evenement, totals } = data
  const reviewsHref = `/dashboard/evenements/${evenementId}/avaliacoes`

  const PRESENCE_FILTER_LABEL: Record<PresenceFilter, string> = {
    all: t("presenceFilter.all"), present: t("presenceFilter.present"), absent: t("presenceFilter.absent"),
  }
  const REVIEW_FILTER_LABEL: Record<ReviewFilter, string> = {
    all: t("reviewFilter.all"), with: t("reviewFilter.with"), without: t("reviewFilter.without"),
  }
  const PAYMENT_STATUS_LABEL: Record<BilanPaymentStatus, string> = {
    PAID: t("paymentStatus.paid"), PENDING: t("paymentStatus.pending"), REFUNDED: t("paymentStatus.refunded"), FREE: t("paymentStatus.free"),
  }
  const paymentMethodLabel = (paymentMethod: EvenementPaymentMethod | null) =>
    paymentMethod ? tRoot(`evenements.publicRegister.${PAYMENT_METHOD_LABEL_KEY[paymentMethod]}`) : null

  function resetFilters() {
    setSearchText("")
    setPresenceFilter("all")
    setReviewFilter("all")
  }

  // The whole event, never the filtered view — the total line has to match the tiles above.
  function handleExport() {
    const header: CsvCell[] = [
      t("csv.participant"), t("csv.email"), t("csv.presence"), t("csv.amount"),
      t("csv.paymentStatus"), t("csv.paymentMethod"), t("csv.rating"), t("csv.comment"),
    ]
    const participantLines: CsvCell[][] = participants.map(row => {
      const amountCents = displayedAmountCents(row)
      return [
        `${row.firstName} ${row.lastName}`,
        row.email,
        row.present ? t("presence.present") : t("presence.absent"),
        amountCents == null ? "" : CSV_AMOUNT_FORMAT.format(amountCents / 100),
        PAYMENT_STATUS_LABEL[row.paymentStatus],
        paymentMethodLabel(row.paymentMethod),
        row.review?.rating,
        row.review?.comment,
      ]
    })
    const totalLine: CsvCell[] = [
      t("csv.total"),
      t("participantCount", { count: totals.participantCount }),
      tBilan("presentCount", { count: totals.presentCount }),
      CSV_AMOUNT_FORMAT.format(totals.revenueCents / 100),
      "", "", t("reviewCount", { count: totals.reviewCount }), "",
    ]
    const fileSlug = evenement.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()
    downloadCsv(
      buildCsv([header, ...participantLines, totalLine]),
      `bilan_${format(new Date(evenement.date), "yyyy-MM-dd")}_${fileSlug}.csv`,
    )
  }

  const columns: Column<BilanParticipantRow>[] = [
    {
      key: "participant",
      header: t("columns.participant"),
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.firstName} {row.lastName}</p>
          {row.email && <p className="truncate text-xs text-muted-foreground">{row.email}</p>}
        </div>
      ),
    },
    {
      key: "presence",
      header: t("columns.presence"),
      cell: (row) => row.present
        ? <Badge variant="success">{t("presence.present")}</Badge>
        : <Badge variant="secondary">{t("presence.absent")}</Badge>,
    },
    {
      key: "amount",
      header: t("columns.amount"),
      className: "text-right",
      cell: (row) => {
        const amountCents = displayedAmountCents(row)
        return (
          <span className="tabular-nums">
            {amountCents == null ? <span className="text-muted-foreground">—</span> : formatEuroCents(amountCents)}
          </span>
        )
      },
    },
    {
      key: "payment",
      header: t("columns.payment"),
      cell: (row) => {
        const methodLabel = paymentMethodLabel(row.paymentMethod)
        return (
          <div className="space-y-0.5">
            <Badge variant={PAYMENT_STATUS_VARIANT[row.paymentStatus]}>{PAYMENT_STATUS_LABEL[row.paymentStatus]}</Badge>
            {methodLabel && <p className="text-xs text-muted-foreground">{methodLabel}</p>}
          </div>
        )
      },
    },
    {
      key: "review",
      header: t("columns.review"),
      cell: (row) => {
        if (!row.review) return <span className="text-sm text-muted-foreground">{tBilan("noReviews")}</span>
        return (
          <div className="min-w-0 max-w-64 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <StarRatingDisplay value={row.review.rating} size="xs" />
              <span className="text-sm tabular-nums">{row.review.rating} / 5</span>
            </div>
            {row.review.comment && <p className="truncate text-xs text-muted-foreground">{row.review.comment}</p>}
            <Link
              href={`${reviewsHref}#avis-${row.review.id}`}
              className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t("viewReview")}
            </Link>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <BackLink href="/dashboard/evenements">{tRoot("evenements.view.title")}</BackLink>

      <PageHeader
        title={evenement.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EvenementStatusBadge status={evenement.status} />
            <span>{format(new Date(evenement.date), "dd MMMM yyyy · HH:mm", { locale: fr })}</span>
          </span>
        }
        action={
          <Button size="sm" variant="outline" onClick={handleExport} disabled={participants.length === 0}>
            <DownloadSimpleIcon className="mr-1.5 size-4" />
            {t("export")}
          </Button>
        }
      />

      <EvenementBilanPanel evenementId={evenementId} showFullBilanLink={false} />

      <section className="space-y-4 pt-4">
        <div className="space-y-1">
          <h2 className="text-base font-medium">{t("sectionTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("sectionSubtitle")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <SearchInput
            value={searchText}
            onValueChange={setSearchText}
            placeholder={t("searchPlaceholder")}
            containerClassName="w-64"
          />
          <Select value={presenceFilter} onValueChange={value => setPresenceFilter((value ?? "all") as PresenceFilter)}>
            {/* Explicit SelectValue children: base-ui only resolves a label on its own when
                Select.Root gets an `items` prop — same workaround as the Dons filters. */}
            <SelectTrigger className="w-48"><SelectValue>{PRESENCE_FILTER_LABEL[presenceFilter]}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{PRESENCE_FILTER_LABEL.all}</SelectItem>
              <SelectItem value="present">{PRESENCE_FILTER_LABEL.present}</SelectItem>
              <SelectItem value="absent">{PRESENCE_FILTER_LABEL.absent}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={reviewFilter} onValueChange={value => setReviewFilter((value ?? "all") as ReviewFilter)}>
            <SelectTrigger className="w-44"><SelectValue>{REVIEW_FILTER_LABEL[reviewFilter]}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{REVIEW_FILTER_LABEL.all}</SelectItem>
              <SelectItem value="with">{REVIEW_FILTER_LABEL.with}</SelectItem>
              <SelectItem value="without">{REVIEW_FILTER_LABEL.without}</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" onClick={resetFilters} className="text-muted-foreground">
              <FunnelXIcon className="size-3.5" />
              {t("resetFilters")}
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          data={filteredParticipants}
          keyExtractor={(row) => row.id}
          empty={hasActiveFilters ? t("emptyFiltered") : t("empty")}
        />

        {/* Whole-event totals, deliberately not following the filters: they must always read
            the same figures as the tiles above (see summarizeBilanParticipantRows). */}
        {participants.length > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums sm:text-right">
            {[
              t("totalAmount", { amount: formatEuroCents(totals.revenueCents) }),
              t("participantCount", { count: totals.participantCount }),
              tBilan("presentCount", { count: totals.presentCount }),
              t("reviewCount", { count: totals.reviewCount }),
            ].join(" · ")}
          </p>
        )}
      </section>
    </div>
  )
}
