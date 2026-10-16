"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { XIcon } from "@phosphor-icons/react/dist/ssr"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { DateField, todayValue } from "@/components/ui/date-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { DonationFormPlacement } from "@/lib/dons/site-section-picks"
import { useAddManualDon, type ManualDonInput } from "@/hooks/use-dons"
import { useCurrentUser } from "@/lib/user-context"

type MembreCandidate = { id: string; firstName: string; lastName: string; email: string }

// Deliberately simple — just enough to catch an obvious typo ("abc", "a@b") before it reaches
// the server, not full RFC 5322 validation. The server's zod `.email()` is still the real
// authority; this only exists so a bad address fails with a field-level message under the
// input instead of a generic 422 toast with no indication of which field was wrong.
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

const NO_FORM = "none"

export function AddManualDonModal({ open, onOpenChange }: Props) {
  const t       = useTranslations("donationForms")
  const tCommon = useTranslations("common")
  const mutation = useAddManualDon()
  const user     = useCurrentUser()

  const [donorMode, setDonorMode] = useState<ManualDonInput["donorMode"]>("member")

  const [memberQuery, setMemberQuery]             = useState("")
  const [debouncedMemberQuery, setDebouncedMemberQuery] = useState("")
  const [selectedMember, setSelectedMember]       = useState<MembreCandidate | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedMemberQuery(memberQuery), 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [memberQuery])

  const memberQueryReady = debouncedMemberQuery.trim().length >= 2
  const { data: candidates = [], isLoading: loadingCandidates } = useQuery<MembreCandidate[]>({
    queryKey: ["membres-search-for-don", debouncedMemberQuery],
    queryFn:  () => fetch(`/api/membres?search=${encodeURIComponent(debouncedMemberQuery.trim())}`).then(r => r.json()),
    enabled:  open && donorMode === "member" && memberQueryReady,
  })

  const [externalFirstName, setExternalFirstName] = useState("")
  const [externalLastName, setExternalLastName]   = useState("")
  const [externalEmail, setExternalEmail]         = useState("")
  const [externalEmailTouched, setExternalEmailTouched] = useState(false)

  const [amount, setAmount]               = useState(0)
  const [paidAt, setPaidAt]               = useState(todayValue())
  const [paymentMethod, setPaymentMethod] = useState<ManualDonInput["paymentMethod"]>("ESPECES")
  const [donationFormId, setDonationFormId] = useState(NO_FORM)
  const [note, setNote]                   = useState("")
  const [sendReceiptEmail, setSendReceiptEmail] = useState(false)
  const [notifyResponsible, setNotifyResponsible] = useState(true)

  const { data: forms = [] } = useQuery<DonationFormPlacement[]>({
    queryKey: ["donation-forms"],
    queryFn:  () => fetch("/api/donation-forms").then(r => r.json()),
    enabled:  open,
  })

  const { data: donSettings } = useQuery<{ responsableId: string | null; responsable: { name: string; email: string } | null }>({
    queryKey: ["dons-settings"],
    queryFn:  () => fetch("/api/dons/settings").then(r => r.ok ? r.json() : { responsableId: null, responsable: null }),
    enabled:  open,
  })
  const hasResponsible = !!donSettings?.responsableId
  useEffect(() => {
    if (!donSettings) return
    setNotifyResponsible(!!donSettings.responsableId && donSettings.responsableId !== user.id)
  }, [donSettings, user.id])

  const email = donorMode === "member" ? (selectedMember?.email ?? "") : externalEmail.trim()
  const hasEmail = email.length > 0
  const externalEmailInvalid = donorMode === "external" && email.length > 0 && !EMAIL_FORMAT_RE.test(email)

  function reset() {
    setDonorMode("member")
    setMemberQuery(""); setDebouncedMemberQuery(""); setSelectedMember(null)
    setExternalFirstName(""); setExternalLastName(""); setExternalEmail(""); setExternalEmailTouched(false)
    setAmount(0); setPaidAt(todayValue()); setPaymentMethod("ESPECES")
    setDonationFormId(NO_FORM); setNote(""); setSendReceiptEmail(false); setNotifyResponsible(true)
  }

  const isValid = amount > 0 && !externalEmailInvalid && (
    donorMode === "member"
      ? !!selectedMember
      : externalFirstName.trim().length > 0 && externalLastName.trim().length > 0
  )

  async function handleSubmit() {
    const payload: ManualDonInput = {
      donorMode,
      amount,
      paidAt,
      paymentMethod,
      donationFormId: donationFormId === NO_FORM ? null : donationFormId,
      note:           note.trim() || undefined,
      sendReceiptEmail: sendReceiptEmail && hasEmail,
      notifyResponsible: notifyResponsible && hasResponsible,
      ...(donorMode === "member"
        ? { membreId: selectedMember!.id }
        : { firstName: externalFirstName.trim(), lastName: externalLastName.trim(), email: email || undefined }),
    }
    try {
      await mutation.mutateAsync(payload)
      toast.success(t("donationsView.toasts.manualDonAdded"))
      onOpenChange(false)
      reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("error"))
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { onOpenChange(next); if (!next) reset() }}
      title={t("addManualDonModal.title")}
      size="lg"
    >
      <div className="space-y-4">
        <Tabs value={donorMode} onValueChange={(v) => setDonorMode(v as ManualDonInput["donorMode"])}>
          <TabsList className="w-full">
            <TabsTrigger value="member" className="flex-1">{t("addManualDonModal.donorModeMember")}</TabsTrigger>
            <TabsTrigger value="external" className="flex-1">{t("addManualDonModal.donorModeExternal")}</TabsTrigger>
          </TabsList>
        </Tabs>

        {donorMode === "member" ? (
          selectedMember ? (
            // A picked member replaces the search box entirely rather than leaving it filled
            // with "Firstname Lastname" — that text re-triggers the debounced search above
            // (memberQuery changed), which never matches anything (the API searches firstName/
            // lastName/email separately, never the concatenated "Firstname Lastname" string) and
            // showed a confusing "no contact found" right under an already-selected contact.
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{selectedMember.firstName} {selectedMember.lastName}</p>
                <p className="text-xs text-muted-foreground truncate">{selectedMember.email}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("addManualDonModal.changeContact")}
                onClick={() => { setSelectedMember(null); setMemberQuery(""); setDebouncedMemberQuery("") }}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Command className="rounded-lg! border" shouldFilter={false}>
                <CommandInput
                  value={memberQuery}
                  onValueChange={(value) => { setMemberQuery(value); setSelectedMember(null) }}
                  placeholder={t("addManualDonModal.searchPlaceholder")}
                />
                <CommandList>
                  {!memberQueryReady ? (
                    <CommandEmpty>{t("addManualDonModal.typeToSearch")}</CommandEmpty>
                  ) : loadingCandidates ? (
                    <div className="p-3 space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>{t("addManualDonModal.noResults")}</CommandEmpty>
                      {candidates.map(member => (
                        <CommandItem
                          key={member.id}
                          value={`${member.lastName} ${member.firstName}`}
                          onSelect={() => setSelectedMember(member)}
                        >
                          <span className="truncate">{member.firstName} {member.lastName}</span>
                          <span className="ml-2 truncate text-xs text-muted-foreground">{member.email}</span>
                        </CommandItem>
                      ))}
                    </>
                  )}
                </CommandList>
              </Command>
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={t("addManualDonModal.firstNameLabel")}
              value={externalFirstName}
              onChange={e => setExternalFirstName(e.target.value)}
            />
            <FormField
              label={t("addManualDonModal.lastNameLabel")}
              value={externalLastName}
              onChange={e => setExternalLastName(e.target.value)}
            />
            <div className="col-span-2">
              <FormField
                label={`${t("addManualDonModal.emailLabel")} ${t("addManualDonModal.emailOptional")}`}
                type="email"
                value={externalEmail}
                onChange={e => setExternalEmail(e.target.value)}
                onBlur={() => setExternalEmailTouched(true)}
                error={externalEmailTouched && externalEmailInvalid ? t("addManualDonModal.invalidEmail") : undefined}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <CurrencyField label={t("addManualDonModal.amountLabel")} required value={amount} onChange={setAmount} />
          <DateField label={t("addManualDonModal.dateLabel")} value={paidAt} onChange={setPaidAt} />
        </div>

        <SelectField
          label={t("addManualDonModal.paymentMethodLabel")}
          required
          value={paymentMethod}
          onValueChange={(value) => setPaymentMethod(value as ManualDonInput["paymentMethod"])}
          options={[
            { value: "ESPECES",  label: t("donationsView.paymentMethod.especes") },
            { value: "CHEQUE",   label: t("donationsView.paymentMethod.cheque") },
            { value: "VIREMENT", label: t("donationsView.paymentMethod.virement") },
            { value: "AUTRE",    label: t("donationsView.paymentMethod.autre") },
          ]}
        />

        <SelectField
          label={t("addManualDonModal.donationFormLabel")}
          value={donationFormId}
          onValueChange={setDonationFormId}
          options={[
            { value: NO_FORM, label: t("addManualDonModal.noFormOption") },
            ...forms.map(form => ({ value: form.id, label: form.title })),
          ]}
        />

        <FormField
          label={t("addManualDonModal.noteLabel")}
          placeholder={t("addManualDonModal.notePlaceholder")}
          value={note}
          onChange={e => setNote(e.target.value)}
        />

        <CheckboxField
          label={t("addManualDonModal.sendReceiptLabel")}
          hint={hasEmail ? t("addManualDonModal.sendReceiptHint") : undefined}
          checked={hasEmail && sendReceiptEmail}
          disabled={!hasEmail}
          onChange={e => setSendReceiptEmail(e.target.checked)}
          className={cn(!hasEmail && "cursor-not-allowed")}
        />

        {hasResponsible && (
          <CheckboxField
            label={t("addManualDonModal.notifyResponsible", { name: donSettings?.responsable?.name || donSettings?.responsable?.email || "" })}
            checked={notifyResponsible}
            onChange={e => setNotifyResponsible(e.target.checked)}
          />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} loading={mutation.isPending} disabled={!isValid}>
            {t("addManualDonModal.submitButton")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
