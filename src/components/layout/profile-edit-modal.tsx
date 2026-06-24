"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button }   from "@/components/ui/button"
import { Input }    from "@/components/ui/input"
import { Label }    from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface Props {
  user: { name?: string | null; email?: string | null }
  onClose: () => void
  onSaved: () => void
}

type Errors = Partial<Record<"firstName" | "lastName" | "email", string>>

function splitName(full: string | null | undefined): [string, string] {
  const trimmed = full?.trim() ?? ""
  const idx     = trimmed.indexOf(" ")
  if (idx === -1) return [trimmed, ""]
  return [trimmed.slice(0, idx), trimmed.slice(idx + 1)]
}

export function ProfileEditModal({ user, onClose, onSaved }: Props) {
  const router = useRouter()
  const [first, last] = splitName(user.name)

  const [firstName, setFirstName] = useState(first)
  const [lastName,  setLastName]  = useState(last)
  const [email,     setEmail]     = useState(user.email ?? "")
  const [saving,    setSaving]    = useState(false)
  const [errors,    setErrors]    = useState<Errors>({})

  function clearError(f: keyof Errors) {
    setErrors((p) => { const e = { ...p }; delete e[f]; return e })
  }

  function validate(): boolean {
    const e: Errors = {}
    if (!firstName.trim()) e.firstName = "Prénom obligatoire."
    if (!lastName.trim())  e.lastName  = "Nom obligatoire."
    if (!email.trim())     e.email     = "E-mail obligatoire."
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "E-mail invalide."
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`
      const res = await fetch("/api/me", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      })
      if (res.ok) {
        toast.success("Profil mis à jour. Le nom dans l'en-tête sera mis à jour à la prochaine connexion.")
        router.refresh()
        onSaved()
      } else {
        const data = await res.json().catch(() => ({}))
        if (data.field === "name") setErrors({ firstName: data.error })
        else if (data.field)       setErrors({ [data.field]: data.error })
        else toast.error(data.error ?? "Erreur lors de la sauvegarde.")
      }
    } catch {
      toast.error("Erreur de connexion. Veuillez réessayer.")
    } finally {
      setSaving(false)
    }
  }

  const currentName = `${firstName.trim()} ${lastName.trim()}`
  const isDirty =
    currentName !== (user.name ?? "").trim() ||
    email.trim().toLowerCase() !== (user.email ?? "").trim().toLowerCase()

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Modifier le profil</DialogTitle></DialogHeader>

        <form
          className="space-y-4 py-1"
          onSubmit={(e) => { e.preventDefault(); handleSave() }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-first">Prénom</Label>
              <Input
                id="p-first" value={firstName} autoFocus
                onChange={(e) => { setFirstName(e.target.value); clearError("firstName") }}
                placeholder="Jean"
                className={cn(errors.firstName && "border-destructive")}
              />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="p-last">Nom</Label>
              <Input
                id="p-last" value={lastName}
                onChange={(e) => { setLastName(e.target.value); clearError("lastName") }}
                placeholder="Dupont"
                className={cn(errors.lastName && "border-destructive")}
              />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-email">E-mail</Label>
            <Input
              id="p-email" type="email" value={email}
              onChange={(e) => { setEmail(e.target.value); clearError("email") }}
              placeholder="votre@email.com"
              className={cn(errors.email && "border-destructive")}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          <button type="submit" className="hidden" aria-hidden />
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} loading={saving}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !isDirty}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
