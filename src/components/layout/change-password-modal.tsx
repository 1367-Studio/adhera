"use client"

import { useState } from "react"
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
    if (!current) e.currentPassword = "Veuillez saisir le mot de passe actuel."
    if (!next)    e.newPassword     = "Veuillez saisir le nouveau mot de passe."
    else if (next.length < 8)       e.newPassword = "Min. 8 caractères."
    else if (next === current)      e.newPassword = "Le nouveau mot de passe doit être différent de l'actuel."
    if (next && !confirm)           e.confirmPassword = "Confirmez le nouveau mot de passe."
    else if (next && next !== confirm) e.confirmPassword = "Les mots de passe ne correspondent pas."
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
      toast.success("Mot de passe modifié.")
      onSaved()
    } else {
      const data = await res.json().catch(() => ({}))
      if (data.field) setErrors({ [data.field]: data.error })
      else toast.error(data.error ?? "Erreur lors de la sauvegarde.")
    }
  }

  const isDirty = !!current && !!next && !!confirm

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Changer le mot de passe</DialogTitle></DialogHeader>

        <form
          className="space-y-4 py-1"
          onSubmit={(e) => { e.preventDefault(); handleSave() }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cp-cur">Mot de passe actuel</Label>
            <Input
              id="cp-cur" type="password" value={current}
              onChange={(e) => { setCurrent(e.target.value); clearError("currentPassword") }}
              placeholder="••••••••" autoComplete="current-password"
              className={cn(errors.currentPassword && "border-destructive")}
            />
            {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-new">Nouveau mot de passe</Label>
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
                    confirmPassword: v !== confirm ? "Les mots de passe ne correspondent pas." : undefined,
                  }))
                }
              }}
              placeholder="Min. 8 caractères" autoComplete="new-password"
              className={cn(errors.newPassword && "border-destructive")}
            />
            {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">Confirmer le nouveau mot de passe</Label>
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
          <Button variant="outline" onClick={onClose} loading={saving}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !isDirty}>
            Modifier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
