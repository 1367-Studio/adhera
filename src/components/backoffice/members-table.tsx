"use client"

import { useState } from "react"
import { toast }    from "sonner"
import { Badge }    from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
import type { UserRole } from "@prisma/client"

type Role = "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE"

type Membre = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  status:    string
  userId:    string | null
  user:      { id: string; email: string; role: UserRole } | null
}

const ROLE_LABELS: Record<Role, string> = {
  ADMIN:      "Admin",
  PRESIDENT:  "Président",
  TRESORIER:  "Trésorier",
  SECRETAIRE: "Secrétaire",
  MEMBRE:     "Membre",
}

const ROLE_OPTIONS: Role[] = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE", "MEMBRE"]

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIF:    "default",
  PENDING:  "secondary",
  INACTIF:  "outline",
  SUSPENDU: "destructive",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIF:    "Actif",
  PENDING:  "En attente",
  INACTIF:  "Inactif",
  SUSPENDU: "Suspendu",
}

export function MembersTable({ associationId, initialMembers }: { associationId: string; initialMembers: Membre[] }) {
  const [membres,    setMembres]    = useState(initialMembers)
  const [pendingId,  setPendingId]  = useState<string | null>(null)

  async function handleRoleChange(userId: string, role: Role) {
    setPendingId(userId)
    try {
      const res = await fetch(`/api/backoffice/associations/${associationId}/members`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userId, role }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Erreur lors du changement de rôle")
        return
      }

      setMembres((prev) =>
        prev.map((m) =>
          m.user?.id === userId ? { ...m, user: { ...m.user!, role } } : m,
        ),
      )
      toast.success("Rôle mis à jour")
    } finally {
      setPendingId(null)
    }
  }

  if (membres.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Aucun membre dans cette association.</p>
  }

  return (
    <TooltipProvider>
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-xs text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-medium">Membre</th>
              <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Email compte</th>
              <th className="text-center px-4 py-2.5 font-medium">Statut</th>
              <th className="text-left px-4 py-2.5 font-medium w-48">Rôle</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {membres.map((m) => {
              const isRowPending = pendingId === m.user?.id
              return (
                <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-medium">{m.firstName} {m.lastName}</span>
                    {m.email && <span className="block text-xs text-muted-foreground">{m.email}</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {m.user?.email ?? (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-xs italic cursor-default">Pas de compte</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Ce membre n&apos;a pas encore accepté son invitation
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={STATUS_VARIANTS[m.status] ?? "outline"}>
                      {STATUS_LABELS[m.status] ?? m.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {m.user ? (
                      <div className="flex items-center gap-2">
                        <Select
                          value={m.user.role}
                          onValueChange={(v) => handleRoleChange(m.user!.id, v as Role)}
                          disabled={isRowPending}
                        >
                          <SelectTrigger className="h-8 text-xs w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r} className="text-xs">
                                {ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isRowPending && <CircleNotchIcon className="size-3.5 animate-spin text-muted-foreground shrink-0" />}
                      </div>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-xs text-muted-foreground italic cursor-default">—</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Le rôle ne peut être défini qu&apos;après la création du compte
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}
