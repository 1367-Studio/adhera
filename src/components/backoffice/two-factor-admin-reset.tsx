"use client"

import { useState } from "react"
import { toast } from "sonner"
import { adminDisableTwoFactor } from "@/lib/auth/two-factor"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface StaffUser {
  id:    string
  name:  string | null
  email: string
  role:  string
}

interface Props {
  users: StaffUser[]
}

export function TwoFactorAdminReset({ users: initialUsers }: Props) {
  const [users, setUsers] = useState(initialUsers)
  const [target, setTarget] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(false)

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun compte avec le 2FA activé.</p>
  }

  async function handleConfirm() {
    if (!target) return
    setLoading(true)
    const result = await adminDisableTwoFactor(target.id)
    setLoading(false)
    if (!result.ok) { toast.error(result.error); return }
    setUsers((prev) => prev.filter((u) => u.id !== target.id))
    toast.success(`2FA désactivé pour ${target.name ?? target.email}.`)
    setTarget(null)
  }

  return (
    <>
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-medium">{u.name ?? u.email}</p>
              <p className="text-xs text-muted-foreground">{u.email} · {u.role}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setTarget(u)}>
              Désactiver le 2FA
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Désactiver le 2FA"
        description={target ? `${target.name ?? target.email} devra le réactiver lui-même après s'être reconnecté.` : undefined}
        confirmLabel="Désactiver"
        loading={loading}
        onConfirm={handleConfirm}
      />
    </>
  )
}
