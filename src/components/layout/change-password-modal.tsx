"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input }  from "@/components/ui/input"
import { Label }  from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface Props {
  onClose: () => void
  onSaved: () => void
}

type Errors = Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>

export function ChangePasswordModal({ onClose, onSaved }: Props) {
  const t = useTranslations("layout.changePasswordModal")
  const tCommon = useTranslations("common")
  const [current, setCurrent] = useState("")
  const [next,    setNext]    = useState("")
  const [confirm, setConfirm] = useState("")
  const [saving,  setSaving]  = useState(false)
  const [errors,  setErrors]  = useState<Errors>({})

  function clearError(f: keyof Errors) {
    setErrors((p) => { const e = { ...p }; delete e[f]; return e })
  }

  function validate(): boolean {
    const e: Errors = {}
    if (!current) e.currentPassword = t("currentPasswordRequired")
    if (!next)    e.newPassword     = t("newPasswordRequired")
    else if (next.length < 8)       e.newPassword = t("newPasswordMinLength")
    else if (next === current)      e.newPassword = t("newPasswordMustDiffer")
    if (next && !confirm)           e.confirmPassword = t("confirmPasswordRequired")
    else if (next && next !== confirm) e.confirmPassword = t("passwordMismatch")
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    const res = await fetch("/api/me", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(t("toastSuccess"))
      onSaved()
    } else {
      const data = await res.json().catch(() => ({}))
      if (data.field) setErrors({ [data.field]: data.error })
      else toast.error(data.error ?? t("toastError"))
    }
  }

  const isDirty = !!current && !!next && !!confirm

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>

        <form
          className="space-y-4 py-1"
          onSubmit={(e) => { e.preventDefault(); handleSave() }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cp-cur">{t("currentPasswordLabel")}</Label>
            <Input
              id="cp-cur" type="password" value={current}
              onChange={(e) => { setCurrent(e.target.value); clearError("currentPassword") }}
              placeholder="••••••••" autoComplete="current-password"
              className={cn(errors.currentPassword && "border-destructive")}
            />
            {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-new">{t("newPasswordLabel")}</Label>
            <Input
              id="cp-new" type="password" value={next}
              onChange={(e) => {
                const v = e.target.value
                setNext(v)
                clearError("newPassword")
                // Re-validate confirm mismatch live if confirm is already filled
                if (confirm) {
                  setErrors((p) => ({
                    ...p,
                    confirmPassword: v !== confirm ? t("passwordMismatch") : undefined,
                  }))
                }
              }}
              placeholder={t("newPasswordMinLength")} autoComplete="new-password"
              className={cn(errors.newPassword && "border-destructive")}
            />
            {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">{t("confirmPasswordLabel")}</Label>
            <Input
              id="cp-confirm" type="password" value={confirm}
              onChange={(e) => { setConfirm(e.target.value); clearError("confirmPassword") }}
              placeholder="••••••••" autoComplete="new-password"
              className={cn(errors.confirmPassword && "border-destructive")}
            />
            {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword}</p>}
          </div>

          {/* Hidden submit so Enter works */}
          <button type="submit" className="hidden" aria-hidden />
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} loading={saving}>{tCommon("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving || !isDirty}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
