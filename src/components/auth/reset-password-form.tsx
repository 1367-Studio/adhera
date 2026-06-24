"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { LoaderCircleIcon, LockIcon, AlertCircleIcon } from "lucide-react"
import { toast } from "sonner"

interface Props {
  token: string
}

export function ResetPasswordForm({ token }: Props) {
  const router = useRouter()

  const [password, setPassword] = useState("")
  const [confirm,  setConfirm]  = useState("")
  const [loading,  setLoading]  = useState(false)
  const [errors,   setErrors]   = useState<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!password)                e.password = "Mot de passe requis."
    else if (password.length < 8) e.password = "Min. 8 caractères."
    if (password && !confirm)     e.confirm  = "Confirmez le mot de passe."
    else if (password !== confirm) e.confirm = "Les mots de passe ne correspondent pas."
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)

    try {
      const res = await fetch("/api/auth/reset-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, password }),
      })

      if (res.ok) {
        toast.success("Mot de passe modifié. Vous pouvez vous connecter.")
        router.replace("/login")
      } else {
        const data = await res.json().catch(() => ({}))
        if (data.field) setErrors(p => ({ ...p, [data.field]: data.error }))
        else toast.error(data.error ?? "Erreur lors de la réinitialisation.")
      }
    } catch {
      toast.error("Erreur réseau. Veuillez réessayer.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormField
        label="Nouveau mot de passe"
        type="password"
        autoComplete="new-password"
        autoFocus
        placeholder="Min. 8 caractères"
        leadingIcon={<LockIcon />}
        value={password}
        onChange={(e) => { setPassword(e.target.value); setErrors(p => ({ ...p, password: "" })) }}
        error={errors.password}
      />

      <FormField
        label="Confirmer le mot de passe"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        leadingIcon={<LockIcon />}
        value={confirm}
        onChange={(e) => { setConfirm(e.target.value); setErrors(p => ({ ...p, confirm: "" })) }}
        error={errors.confirm}
      />

      {errors.token && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span>{errors.token}</span>
        </div>
      )}

      <Button type="submit" className="w-full mt-2" disabled={loading}>
        {loading && <LoaderCircleIcon className="mr-2 size-4 animate-spin" />}
        Enregistrer le nouveau mot de passe
      </Button>
    </form>
  )
}
