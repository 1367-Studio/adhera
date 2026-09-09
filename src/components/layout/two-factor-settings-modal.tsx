"use client"

import { useEffect, useState } from "react"
import QRCode from "react-qr-code"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input }  from "@/components/ui/input"
import { Label }  from "@/components/ui/label"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { Separator } from "@/components/ui/separator"
import { CircleNotchIcon, CopyIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr"
import {
  initTotpSetup, confirmTotpSetup, disableTwoFactor, regenerateBackupCodes, getTwoFactorStatus,
} from "@/lib/auth/two-factor"

interface Props {
  onClose: () => void
}

type View = "status" | "setup-qr" | "setup-codes" | "disable" | "regen-code" | "regen-codes"

export function TwoFactorSettingsModal({ onClose }: Props) {
  const t = useTranslations("layout.twoFactorSettingsModal")

  const [loading, setLoading]     = useState(true)
  const [enabled, setEnabled]     = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [view, setView]           = useState<View>("status")
  const [busy, setBusy]           = useState(false)

  const [totpUri, setTotpUri]     = useState("")
  const [setupCode, setSetupCode] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [savedCodes, setSavedCodes]   = useState(false)

  const [password, setPassword]   = useState("")
  const [regenCode, setRegenCode] = useState("")

  // Codes that are shown only once and become worthless the moment they're regenerated
  // (regen-codes) or the only way to see them again is starting over (setup-codes) — the
  // dialog must not be dismissible out from under the user here until they've confirmed
  // they saved them, see onOpenChange below.
  const hasUnsavedCodes = (view === "setup-codes" || view === "regen-codes") && !savedCodes

  useEffect(() => {
    getTwoFactorStatus().then((result) => {
      if (result.ok) {
        setEnabled(result.enabled)
        setRemaining(result.backupCodesRemaining)
      } else {
        toast.error(result.error)
      }
      setLoading(false)
    })
  }, [])

  async function handleStartSetup() {
    setBusy(true)
    const result = await initTotpSetup()
    setBusy(false)
    if (!result.ok) { toast.error(result.error); return }
    setTotpUri(result.totpUri)
    setView("setup-qr")
  }

  async function handleConfirmSetup(e: React.FormEvent) {
    e.preventDefault()
    if (setupCode.length < 6) return
    setBusy(true)
    const result = await confirmTotpSetup(setupCode)
    setBusy(false)
    if (!result.ok) { toast.error(result.error); setSetupCode(""); return }
    setBackupCodes(result.backupCodes)
    setEnabled(true)
    setSetupCode("")
    setView("setup-codes")
  }

  function finishSetup() {
    setRemaining(backupCodes.length)
    setBackupCodes([])
    setSavedCodes(false)
    setView("status")
    toast.success(t("enabledToast"))
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const result = await disableTwoFactor(password)
    setBusy(false)
    if (!result.ok) { toast.error(result.error); return }
    setEnabled(false)
    setPassword("")
    setView("status")
    toast.success(t("disabledToast"))
  }

  async function handleRegen(e: React.FormEvent) {
    e.preventDefault()
    if (regenCode.length < 6) return
    setBusy(true)
    const result = await regenerateBackupCodes(regenCode)
    setBusy(false)
    if (!result.ok) { toast.error(result.error); setRegenCode(""); return }
    setBackupCodes(result.backupCodes)
    setRegenCode("")
    setView("regen-codes")
  }

  function finishRegen() {
    setRemaining(backupCodes.length)
    setBackupCodes([])
    setSavedCodes(false)
    setView("status")
    toast.success(t("regeneratedToast"))
  }

  return (
    <Dialog
      open
      onOpenChange={(open, eventDetails) => {
        // Blocks the X button, Escape, and outside-clicks alike while unsaved one-time
        // codes are on screen — otherwise any of those silently destroys codes that can
        // never be shown again (regen-codes' old codes are already gone from the database
        // by the time the new ones render). The explicit "Terminé" button still works: it
        // never goes through onOpenChange at all, it just calls finishSetup/finishRegen
        // directly once `savedCodes` is checked.
        if (!open && hasUnsavedCodes) {
          eventDetails.cancel()
          return
        }
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={!hasUnsavedCodes}>
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <CircleNotchIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : view === "status" ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">
                {enabled ? t("statusEnabled") : t("statusDisabled")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {enabled ? t("statusEnabledDescription") : t("statusDisabledDescription")}
              </p>
            </div>

            {enabled && (
              <>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm">{t("backupCodesLabel")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("backupCodesRemaining", { count: remaining })}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setView("regen-code")}>
                    {t("regenerate")}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : view === "setup-qr" ? (
          <form onSubmit={handleConfirmSetup} className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">{t("scanTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("scanDescription")}</p>
            </div>

            <div className="flex justify-center rounded-md border border-border p-4">
              <QRCode value={totpUri} size={160} />
            </div>

            <CopyableSecret uri={totpUri} label={t("manualEntryLabel")} />

            <Separator />

            <div className="space-y-1.5">
              <Label htmlFor="tfa-setup-code">{t("confirmCodeLabel")}</Label>
              <Input
                id="tfa-setup-code"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                type="tel"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                className="text-center font-mono tracking-[0.3em]"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setView("status")}>{t("cancel")}</Button>
              <Button type="submit" loading={busy} disabled={setupCode.length < 6}>{t("confirm")}</Button>
            </DialogFooter>
          </form>
        ) : view === "setup-codes" || view === "regen-codes" ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">{t("backupCodesTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("backupCodesDescription")}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((c) => (
                <code key={c} className="rounded-md border border-border px-2 py-1.5 text-center text-sm font-mono">
                  {c}
                </code>
              ))}
            </div>

            <CopyAllButton codes={backupCodes} label={t("copyAll")} copiedLabel={t("copied")} />

            <CheckboxField
              label={t("savedCodesConfirm")}
              checked={savedCodes}
              onChange={(e) => setSavedCodes(e.target.checked)}
            />

            <DialogFooter>
              <Button
                type="button"
                disabled={!savedCodes}
                onClick={view === "setup-codes" ? finishSetup : finishRegen}
              >
                {t("done")}
              </Button>
            </DialogFooter>
          </div>
        ) : view === "disable" ? (
          <form onSubmit={handleDisable} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("disableDescription")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="tfa-disable-password">{t("passwordLabel")}</Label>
              <Input
                id="tfa-disable-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setView("status"); setPassword("") }}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="destructive" loading={busy} disabled={!password}>
                {t("disableConfirm")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleRegen} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("regenDescription")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="tfa-regen-code">{t("confirmCodeLabel")}</Label>
              <Input
                id="tfa-regen-code"
                value={regenCode}
                onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                type="tel"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                autoFocus
                className="text-center font-mono tracking-[0.3em]"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setView("status"); setRegenCode("") }}>
                {t("cancel")}
              </Button>
              <Button type="submit" loading={busy} disabled={regenCode.length < 6}>{t("confirm")}</Button>
            </DialogFooter>
          </form>
        )}

        {!loading && view === "status" && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("close")}</Button>
            {enabled ? (
              <Button type="button" variant="destructive" onClick={() => setView("disable")}>
                {t("disable")}
              </Button>
            ) : (
              <Button type="button" loading={busy} onClick={handleStartSetup}>
                {t("enable")}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CopyableSecret({ uri, label }: { uri: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const secret = new URL(uri).searchParams.get("secret") ?? ""

  function copy() {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
        <code className="flex-1 truncate text-xs font-mono">{secret}</code>
        <button type="button" onClick={copy} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}

function CopyAllButton({ codes, label, copiedLabel }: { codes: string[]; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(codes.join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? copiedLabel : label}
    </button>
  )
}
