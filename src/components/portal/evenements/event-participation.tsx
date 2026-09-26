"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect } from "react"
import { useTranslations, useLocale } from "next-intl"
import { CircleNotchIcon, TicketIcon, CheckCircleIcon, ProhibitIcon, BookmarkSimpleIcon, HourglassIcon } from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner"
import { useSetRsvp, useSubmitReview, type GuestInput } from "@/hooks/use-evenements"
import { PriceBadge } from "@/components/ui/price-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { Modal } from "@/components/ui/modal"
import { StarRating } from "@/components/ui/star-rating"
import { apiErrorMessage } from "@/lib/api-error"
import { cn } from "@/lib/utils"
import { cheapestAvailableTicketTypePrice } from "@/lib/ticket-types"
import { evenementHasFee, type Evenement, type EvenementTicketType, type RsvpCounts, type RsvpStatus } from "./types"

function ticketTypeOptionLabel(ticketType: EvenementTicketType, locale: string, t: ReturnType<typeof useTranslations>, tCommon: ReturnType<typeof useTranslations>): string {
  const price = Number(ticketType.price)
  const label = `${ticketType.label} — ${price === 0 ? tCommon("free") : price.toLocaleString(locale, { style: "currency", currency: "EUR" })}`
  return ticketType.full ? `${label} ${t("ticketTypeFullSuffix")}` : label
}

function defaultTicketType(ticketTypes: EvenementTicketType[]): EvenementTicketType | undefined {
  return ticketTypes.find(ticketType => !ticketType.full) ?? ticketTypes[0]
}

function TicketTypeSelect({
  ticketTypes,
  value,
  onChange,
}: {
  ticketTypes: EvenementTicketType[]
  value:       string | undefined
  onChange:    (ticketTypeId: string) => void
}) {
  const t       = useTranslations("portalMembre.evenements")
  const tCommon = useTranslations("common")
  const locale  = useLocale()
  return (
    <select
      value={value ?? defaultTicketType(ticketTypes)?.id}
      onChange={changeEvent => onChange(changeEvent.target.value)}
      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
    >
      {ticketTypes.map(ticketType => (
        <option key={ticketType.id} value={ticketType.id} disabled={ticketType.full}>{ticketTypeOptionLabel(ticketType, locale, t, tCommon)}</option>
      ))}
    </select>
  )
}

function GuestNameFields({
  count,
  guests,
  onChange,
  ticketTypes,
}: {
  count:    number
  guests:   GuestInput[]
  onChange: (guests: GuestInput[]) => void
  ticketTypes?: EvenementTicketType[]
}) {
  const t = useTranslations("portalMembre.evenements")
  if (count <= 0) return null
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground">{t("guestsLabel")}</span>
      {[...Array(count).keys()].map(guestIndex => {
        const guest = guests[guestIndex] ?? { firstName: "", lastName: "" }
        const updateGuest = (patch: Partial<GuestInput>) => {
          const nextGuests = [...guests]
          nextGuests[guestIndex] = { ...guest, ...patch }
          onChange(nextGuests)
        }
        return (
          <div key={guestIndex} className="space-y-1">
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder={t("guestFirstNamePlaceholder", { n: guestIndex + 1 })}
                value={guest.firstName}
                onChange={changeEvent => updateGuest({ firstName: changeEvent.target.value })}
                className="w-1/2 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                placeholder={t("guestLastNamePlaceholder", { n: guestIndex + 1 })}
                value={guest.lastName}
                onChange={changeEvent => updateGuest({ lastName: changeEvent.target.value })}
                className="w-1/2 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <input
              type="email"
              placeholder={t("guestEmailPlaceholder")}
              value={guest.email ?? ""}
              onChange={changeEvent => updateGuest({ email: changeEvent.target.value })}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            {ticketTypes && ticketTypes.length > 0 && (
              <TicketTypeSelect
                ticketTypes={ticketTypes}
                value={guest.ticketTypeId}
                onChange={ticketTypeId => updateGuest({ ticketTypeId })}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

type TicketRow = {
  id:           string
  firstName:    string
  lastName:     string
  isSelf:       boolean
  present:      boolean
  ticketPaidAt: string | null
  rsvp:         RsvpStatus | null
}

const RSVP_OPTIONS: { value: RsvpStatus; labelKey: "rsvpConfirme" | "rsvpProvavel" | "rsvpIncerto" | "rsvpAbsent"; dot: string; color: string; activeColor: string }[] = [
  {
    value:       "CONFIRME",
    labelKey:    "rsvpConfirme",
    dot:         "bg-green-500",
    color:       "border-border text-muted-foreground hover:border-green-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30",
    activeColor: "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  },
  {
    value:       "PROVAVEL",
    labelKey:    "rsvpProvavel",
    dot:         "bg-yellow-400",
    color:       "border-border text-muted-foreground hover:border-yellow-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950/30",
    activeColor: "border-yellow-400 bg-yellow-50 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
  },
  {
    value:       "INCERTO",
    labelKey:    "rsvpIncerto",
    dot:         "bg-orange-400",
    color:       "border-border text-muted-foreground hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30",
    activeColor: "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  },
  {
    value:       "ABSENT",
    labelKey:    "rsvpAbsent",
    dot:         "bg-red-500",
    color:       "border-border text-muted-foreground hover:border-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30",
    activeColor: "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
]

function rsvpLabelKey(rsvp: RsvpStatus): (typeof RSVP_OPTIONS)[number]["labelKey"] {
  return RSVP_OPTIONS.find(option => option.value === rsvp)?.labelKey ?? "rsvpConfirme"
}

function TicketButton({ evenementId, quantity, guests, ticketTypeId, free }: { evenementId: string; quantity: number; guests: GuestInput[]; ticketTypeId?: string; free?: boolean }) {
  const t           = useTranslations("portalMembre.evenements")
  const tCommon     = useTranslations("common")
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/portal/evenements/${evenementId}/checkout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ quantity, guests, ticketTypeId }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response, t("paymentError")))
      return response.json() as Promise<{ url: string } | { waitlisted: true }>
    },
    onSuccess: (data) => {
      if ("waitlisted" in data) {
        toast.success(t("waitlistedToast"))
        queryClient.invalidateQueries({ queryKey: ["portal-evenements"] })
        return
      }
      window.location.href = data.url
    },
    onError:   (err) => {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
      // A tier could have just filled up (someone else took the last spot) — refresh so
      // the picker reflects that instead of letting the visitor retry the same dead end.
      queryClient.invalidateQueries({ queryKey: ["portal-evenements"] })
    },
  })

  return (
    <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()} className="w-full">
      <TicketIcon className="size-3.5 mr-1.5" />
      {free ? tCommon("confirm") : t("payOnline")}{quantity > 1 ? ` (×${quantity})` : ""}
    </Button>
  )
}

function PaidEventSection({
  evenementId,
  ticketPaid,
  ticketQuantity,
  rsvp,
  connectEnabled,
  isFull,
  remainingCapacity,
  price,
  ticketTypes,
  registrationsClosed,
}: {
  evenementId:       string
  ticketPaid:        boolean
  ticketQuantity:    number
  rsvp:              string | null
  connectEnabled:    boolean
  isFull:            boolean
  remainingCapacity: number | null
  price:             string | null
  ticketTypes:       EvenementTicketType[]
  registrationsClosed: boolean
}) {
  const t       = useTranslations("portalMembre.evenements")
  const tCommon = useTranslations("common")
  const locale  = useLocale()
  const [quantity, setQuantity] = useState(ticketQuantity)
  const [guests, setGuests]     = useState<GuestInput[]>([])
  const [selfTicketTypeId, setSelfTicketTypeId] = useState<string | undefined>(defaultTicketType(ticketTypes)?.id)
  const [cancelTarget, setCancelTarget] = useState<string | "ALL" | null>(null)
  const [confirmCancelReservation, setConfirmCancelReservation] = useState(false)
  const setRsvpMutation = useSetRsvp(evenementId)
  const queryClient = useQueryClient()

  // Fetched whenever there's a live reservation (paid or not) — needed both to list
  // individual paid seats and to know how many companions are already paid in cash
  // when warning about cancelling an unpaid reservation.
  const ticketsQuery = useQuery<TicketRow[]>({
    queryKey: ["portal-evenements", evenementId, "tickets"],
    queryFn:  () => fetch(`/api/portal/evenements/${evenementId}/tickets`).then(response => response.json()),
    enabled:  rsvp === "CONFIRME",
  })
  const tickets = ticketsQuery.data ?? []

  const cancelTicketMutation = useMutation({
    mutationFn: async (participationId?: string) => {
      const response = await fetch(`/api/portal/evenements/${evenementId}/cancel-ticket`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(participationId ? { participationId } : {}),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response, tCommon("error")))
      return response.json()
    },
    onSuccess: () => {
      toast.success(t("ticketCancelledToast"))
      queryClient.invalidateQueries({ queryKey: ["portal-evenements"] })
      queryClient.invalidateQueries({ queryKey: ["portal-evenements", evenementId, "tickets"] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  useEffect(() => { setQuantity(ticketQuantity) }, [ticketQuantity])

  // The tier <select> for each guest row visually defaults to the first tier (native
  // <select> behavior) even before the user touches it — without this, that default is
  // only cosmetic and `guests[i].ticketTypeId` stays undefined until they actually click
  // it, so submitting without interacting would send a seat with no tier at all. Keep
  // state in sync with what's shown as soon as a seat exists.
  useEffect(() => {
    const defaultTicketTypeId = defaultTicketType(ticketTypes)?.id
    if (!defaultTicketTypeId) return
    setGuests(previousGuests => {
      let changed = false
      const nextGuests = previousGuests.slice()
      for (let guestIndex = 0; guestIndex < quantity - 1; guestIndex++) {
        const guest = nextGuests[guestIndex] ?? { firstName: "", lastName: "" }
        if (!guest.ticketTypeId) { nextGuests[guestIndex] = { ...guest, ticketTypeId: defaultTicketTypeId }; changed = true }
      }
      return changed ? nextGuests : previousGuests
    })
  }, [quantity, ticketTypes])

  const unitPrice = price != null ? Number(price) : null
  const maxQty = remainingCapacity != null ? Math.min(10, remainingCapacity) : 10

  function resolveTierPrice(ticketTypeId: string | undefined): number {
    return Number(ticketTypes.find(ticketType => ticketType.id === ticketTypeId)?.price ?? ticketTypes[0]?.price ?? 0)
  }

  // Each seat (self + guests) can carry its own tier once the event has ticket types —
  // sum those instead of unitPrice * quantity, which only holds when every seat is priced
  // the same (the flat-price case).
  const total = ticketTypes.length > 0
    ? resolveTierPrice(selfTicketTypeId) + guests.slice(0, quantity - 1).reduce((sum, guest) => sum + resolveTierPrice(guest.ticketTypeId), 0)
    : unitPrice != null ? unitPrice * quantity : null

  // A tiered event where every currently-selected seat is on a 0€ tier has nothing to pay
  // for — the "reserve, pay on-site" cash option doesn't apply (there's no cash to collect),
  // and would otherwise leave the reservation stuck "confirmed but never marked paid"
  // forever since nothing ever triggers ticketPaidAt for it.
  const allFree = ticketTypes.length > 0 && total === 0

  const TotalLine = quantity > 1 && total != null ? (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{t("totalLabel")}</span>
      <span className="font-medium tabular-nums">
        {total.toLocaleString(locale, { style: "currency", currency: "EUR" })}
      </span>
    </div>
  ) : null

  if (ticketPaid) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
          <CheckCircleIcon className="size-3.5" />
          {t("ticketsPurchased", { n: ticketQuantity })}
        </div>
        {ticketQuantity > 1 ? (
          <div className="space-y-1">
            {tickets.length === 0 && ticketsQuery.isLoading && (
              <p className="text-xs text-muted-foreground">{tCommon("loading")}</p>
            )}
            {tickets.map(ticket => (
              <div key={ticket.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">
                  {ticket.lastName} {ticket.firstName}{ticket.isSelf ? t("youSuffix") : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setCancelTarget(ticket.id)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-destructive underline-offset-2 hover:underline"
                >
                  {tCommon("cancel")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => setCancelTarget("ALL")}
          >
            {t("cancelAndRefund")}
          </Button>
        )}
        <ConfirmDialog
          open={!!cancelTarget}
          onOpenChange={isOpen => { if (!isOpen) setCancelTarget(null) }}
          title={ticketQuantity > 1 ? t("cancelSeatTitle") : t("cancelTicketTitle")}
          description={(() => {
            if (cancelTarget === "ALL" || ticketQuantity <= 1)
              return t("refundOriginalMethod")
            const target = tickets.find(ticket => ticket.id === cancelTarget)
            return target?.isSelf
              ? t("refundSelfOnly")
              : t("refundGuestOnly")
          })()}
          confirmLabel={t("cancelAndRefundConfirm")}
          loading={cancelTicketMutation.isPending}
          onConfirm={() => {
            const target = cancelTarget && cancelTarget !== "ALL" ? cancelTarget : undefined
            cancelTicketMutation.mutate(target)
            setCancelTarget(null)
          }}
        />
      </div>
    )
  }

  if (rsvp === "CONFIRME") {
    const maxQtyConfirme = remainingCapacity != null
      ? Math.min(10, ticketQuantity + remainingCapacity)
      : 10
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <BookmarkSimpleIcon className="size-3.5" />
          {t("reservedPayOnSite")}
        </div>
        {/* Registrations closed: the reservation stands (and can still be cancelled), but no
            seat can be added or bought online any more. */}
        {!registrationsClosed && (
          <>
            {maxQtyConfirme > 1 && (
              <QuantityStepper value={quantity} onChange={setQuantity} max={maxQtyConfirme} label={t("seatsCountLabel")} />
            )}
            {ticketTypes.length > 0 && (
              <TicketTypeSelect ticketTypes={ticketTypes} value={selfTicketTypeId} onChange={setSelfTicketTypeId} />
            )}
            <GuestNameFields count={quantity - 1} guests={guests} onChange={setGuests} ticketTypes={ticketTypes} />
            {TotalLine}
            {(connectEnabled || allFree) && <TicketButton evenementId={evenementId} quantity={quantity} guests={guests} ticketTypeId={selfTicketTypeId} free={allFree} />}
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="w-full text-muted-foreground"
          loading={setRsvpMutation.isPending}
          onClick={() => setConfirmCancelReservation(true)}
        >
          {t("cancelReservation")}
        </Button>
        <ConfirmDialog
          open={confirmCancelReservation}
          onOpenChange={setConfirmCancelReservation}
          title={t("cancelReservation")}
          description={(() => {
            if (ticketQuantity <= 1) return t("cancelReservationSimple")
            const paidCompanions = tickets.filter(ticket => !ticket.isSelf && ticket.ticketPaidAt).length
            return paidCompanions > 0
              ? t("cancelReservationPaidCompanions", { n: paidCompanions })
              : t("cancelReservationWithCompanions", { n: ticketQuantity - 1 })
          })()}
          confirmLabel={t("cancelReservation")}
          loading={setRsvpMutation.isPending}
          onConfirm={() => {
            setConfirmCancelReservation(false)
            setRsvpMutation.mutate({ rsvp: "ABSENT" }, {
              onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
            })
          }}
        />
      </div>
    )
  }

  if (rsvp === "LISTA_ESPERA") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium">
        <HourglassIcon className="size-3.5" />
        {t("onWaitlist")}
      </div>
    )
  }

  if (isFull) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
        <ProhibitIcon className="size-3.5" />
        {t("eventFull")}
      </div>
    )
  }

  if (registrationsClosed) {
    return <p className="text-xs text-muted-foreground">{t("registrationsClosed")}</p>
  }

  return (
    <div className="space-y-2">
      {maxQty > 1 && (
        <QuantityStepper value={quantity} onChange={setQuantity} max={maxQty} label={t("seatsCountLabel")} />
      )}
      {ticketTypes.length > 0 && (
        <TicketTypeSelect ticketTypes={ticketTypes} value={selfTicketTypeId} onChange={setSelfTicketTypeId} />
      )}
      <GuestNameFields count={quantity - 1} guests={guests} onChange={setGuests} ticketTypes={ticketTypes} />
      {TotalLine}
      {(connectEnabled || allFree) && <TicketButton evenementId={evenementId} quantity={quantity} guests={guests} ticketTypeId={selfTicketTypeId} free={allFree} />}
      {!allFree && (
        <Button
          size="sm"
          variant={connectEnabled ? "outline" : "default"}
          className="w-full"
          loading={setRsvpMutation.isPending}
          onClick={() => setRsvpMutation.mutate({ rsvp: "CONFIRME", quantity, guests, ticketTypeId: selfTicketTypeId }, {
            onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
          })}
        >
          <BookmarkSimpleIcon className="size-3.5 mr-1.5" />
          {t("reserveButton")}
        </Button>
      )}
    </div>
  )
}

function RsvpButtons({ evenementId, current }: { evenementId: string; current: RsvpStatus | null }) {
  const t                         = useTranslations("portalMembre.evenements")
  const mutation                  = useSetRsvp(evenementId)
  const [pending, setPending]     = useState<RsvpStatus | null>(null)
  const selected = mutation.isPending ? pending : current

  async function handle(rsvp: RsvpStatus) {
    if (rsvp === selected || mutation.isPending) return
    setPending(rsvp)
    try {
      const data = await mutation.mutateAsync({ rsvp })
      if (data?.waitlisted) {
        toast.success(t("waitlistedToast"))
      } else {
        toast.success(t("rsvpRecordedToast", { label: t(rsvpLabelKey(rsvp)) }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("rsvpSaveError"))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2 pt-1">
      {RSVP_OPTIONS.map(option => {
        const isActive  = selected === option.value
        const isLoading = mutation.isPending && pending === option.value
        return (
          <button
            key={option.value}
            type="button"
            disabled={mutation.isPending}
            onClick={() => handle(option.value)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
              isActive ? option.activeColor : option.color,
              mutation.isPending && !isActive && "opacity-40 cursor-not-allowed",
            )}
          >
            {isLoading
              ? <CircleNotchIcon className="size-3 shrink-0 animate-spin" />
              : <span className={cn("size-2 rounded-full shrink-0", option.dot)} />
            }
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )
}

function FreeEventGuestsPanel({
  evenementId,
  partySize,
  remainingCapacity,
}: {
  evenementId:       string
  partySize:         number
  remainingCapacity: number | null
}) {
  const t = useTranslations("portalMembre.evenements")
  const tCommon = useTranslations("common")
  const [quantity, setQuantity] = useState(partySize)
  const [guests, setGuests]     = useState<GuestInput[]>([])
  // Only pre-expand when the member already has companions — otherwise the panel would
  // clutter every free-event card even for the common case of attending alone.
  const [expanded, setExpanded] = useState(partySize > 1)
  const mutation = useSetRsvp(evenementId)

  useEffect(() => { setQuantity(partySize) }, [partySize])

  const maxQty = remainingCapacity != null ? Math.min(10, partySize + remainingCapacity) : 10
  const dirty  = quantity !== partySize || guests.length > 0

  if (maxQty <= 1 && !dirty) return null

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        {t("addGuestsButton")}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-2.5">
      <QuantityStepper value={quantity} onChange={setQuantity} max={maxQty} label={t("seatsCountLabel")} />
      <GuestNameFields count={quantity - 1} guests={guests} onChange={setGuests} />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          loading={mutation.isPending}
          onClick={() => mutation.mutate({ rsvp: "CONFIRME", quantity, guests }, {
            onSuccess: () => toast.success(t("guestsUpdatedToast")),
            onError:   (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
          })}
        >
          {t("updateGuestsButton")}
        </Button>
      )}
    </div>
  )
}

function RsvpCounters({ counts }: { counts: RsvpCounts }) {
  const t = useTranslations("portalMembre.evenements")
  const total = counts.CONFIRME + counts.PROVAVEL + counts.INCERTO + counts.ABSENT + counts.LISTA_ESPERA
  if (total === 0) return null

  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {counts.CONFIRME > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-green-500" />{t("countConfirmed", { n: counts.CONFIRME })}</span>}
      {counts.PROVAVEL > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-yellow-400" />{t("countProvavel", { n: counts.PROVAVEL })}</span>}
      {counts.INCERTO  > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-orange-400" />{t("countIncerto", { n: counts.INCERTO })}</span>}
      {counts.ABSENT   > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" />{t("countAbsent", { n: counts.ABSENT })}</span>}
      {counts.LISTA_ESPERA > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-blue-400" />{t("countWaitlist", { n: counts.LISTA_ESPERA })}</span>}
    </div>
  )
}

function EventReviewSection({ evenementId, alreadySubmitted }: { evenementId: string; alreadySubmitted: boolean }) {
  const t                     = useTranslations("portalMembre.evenements")
  const tCommon               = useTranslations("common")
  const [open, setOpen]       = useState(false)
  const [rating, setRating]   = useState(0)
  const [comment, setComment] = useState("")
  const submitReview          = useSubmitReview(evenementId)

  if (alreadySubmitted) {
    return <p className="text-xs text-muted-foreground">{t("reviewSentThanks")}</p>
  }

  function handleSubmit() {
    if (rating < 1) { toast.error(t("chooseRatingError")); return }
    submitReview.mutate({ rating, comment: comment.trim() || undefined }, {
      onSuccess: () => setOpen(false),
      onError:   err => toast.error(err instanceof Error ? err.message : tCommon("error")),
    })
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("leaveReview")}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("leaveReview")}
        footer={
          <Button loading={submitReview.isPending} onClick={handleSubmit}>
            {t("send")}
          </Button>
        }
      >
        <div className="space-y-4 py-1">
          <StarRating value={rating} onChange={setRating} />
          <textarea
            value={comment}
            onChange={changeEvent => setComment(changeEvent.target.value)}
            placeholder={t("commentPlaceholder")}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </Modal>
    </>
  )
}

/**
 * Everything a member does with an event once they've read its header: price/tickets,
 * RSVP counters and buttons, guests, and — for past events — presence and review.
 * Rendered as siblings (a fragment) so the parent's vertical spacing applies between them;
 * shared by the list card and the event detail page.
 */
export function EventParticipation({
  evenement,
  isPast,
  connectEnabled,
  optimisticPaidId,
}: {
  evenement:        Evenement
  isPast?:          boolean
  connectEnabled:   boolean
  optimisticPaidId: string | null
}) {
  const t                 = useTranslations("portalMembre.evenements")
  const participation     = evenement.participations[0] ?? null
  const currentRsvp       = participation?.rsvp ?? null
  const ticketPaid        = participation?.ticketPaidAt != null || optimisticPaidId === evenement.id
  const ticketQuantity    = participation ? evenement.partySize : 1
  const hasTicketTypes    = evenement.ticketTypes.length > 0
  const hasFee            = evenementHasFee(evenement)
  const cheapestTicketTypePrice = hasTicketTypes ? cheapestAvailableTicketTypePrice(evenement.ticketTypes) : null
  const remainingCapacity = evenement.capacity != null ? Math.max(0, evenement.capacity - evenement.confirmedCount) : null
  const allTicketTypesFull = hasTicketTypes && evenement.ticketTypes.every(ticketType => ticketType.full)
  const registrationsClosed = evenement.registrationsClosedAt != null
  const isFull            = (allTicketTypesFull || (evenement.capacity != null && evenement.confirmedCount >= evenement.capacity)) && !ticketPaid && currentRsvp !== "CONFIRME"

  return (
    <>
      {/* Tarif + ticket */}
      {hasFee && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">{t("priceLabel")}</span>
              {evenement.ticketTypes.length > 1
                ? <PriceBadge price={cheapestTicketTypePrice} fromPrice />
                : hasTicketTypes
                  ? <PriceBadge price={evenement.ticketTypes[0].price} />
                  : <PriceBadge price={evenement.price} />}
            </div>
            {evenement.capacity != null && (
              <span className={cn(
                "text-xs font-medium tabular-nums",
                evenement.confirmedCount >= evenement.capacity
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground",
              )}>
                {t("reservedCount", { confirmed: evenement.confirmedCount, capacity: evenement.capacity })}
                {evenement.confirmedCount >= evenement.capacity && t("fullSuffix")}
              </span>
            )}
          </div>
          {!isPast && (
            <PaidEventSection
              evenementId={evenement.id}
              ticketPaid={ticketPaid}
              ticketQuantity={ticketQuantity}
              rsvp={participation?.rsvp ?? null}
              connectEnabled={connectEnabled}
              isFull={isFull}
              remainingCapacity={remainingCapacity}
              price={evenement.price}
              ticketTypes={evenement.ticketTypes}
              registrationsClosed={registrationsClosed}
            />
          )}
          {isPast && ticketPaid && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircleIcon className="size-3.5" />
              {t("ticketsPurchased", { n: 1 })}
            </div>
          )}
        </div>
      )}

      {/* RSVP counts — only for free events */}
      {!hasFee && <RsvpCounters counts={evenement.rsvpCounts} />}

      {/* Bottom section */}
      {isPast ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("presenceLabel")}</span>
            {participation ? (
              participation.present
                ? <span className="font-medium text-green-600 dark:text-green-400">{t("present")}</span>
                : <span className="font-medium text-muted-foreground">{t("presenceAbsent")}</span>
            ) : (
              <span className="text-muted-foreground italic">{t("presenceNotRecorded")}</span>
            )}
            {currentRsvp && !hasFee && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground">
                  {t("rsvpDisplay", { label: t(rsvpLabelKey(currentRsvp)) })}
                </span>
              </>
            )}
          </div>
          {participation?.present && (
            <EventReviewSection evenementId={evenement.id} alreadySubmitted={!!participation.avis} />
          )}
        </div>
      ) : !hasFee && registrationsClosed ? (
        // Free event whose registrations the manager closed: show the recorded answer, no buttons.
        <div className="space-y-1 text-xs text-muted-foreground">
          {currentRsvp && (
            <p>{t("rsvpDisplay", { label: t(rsvpLabelKey(currentRsvp)) })}</p>
          )}
          <p>{t("registrationsClosed")}</p>
        </div>
      ) : !hasFee ? (
        // Free event: show RSVP buttons
        <div className="space-y-2">
          <p className={cn(
            "text-xs font-medium",
            currentRsvp ? "text-muted-foreground" : "text-foreground",
          )}>
            {currentRsvp ? t("yourResponseLabel") : t("confirmParticipationLabel")}
          </p>
          <RsvpButtons evenementId={evenement.id} current={currentRsvp} />
          {currentRsvp === "CONFIRME" && (
            <FreeEventGuestsPanel evenementId={evenement.id} partySize={ticketQuantity} remainingCapacity={remainingCapacity} />
          )}
        </div>
      ) : null}
    </>
  )
}
