"use client"

import { useState } from "react"
import { LogOutIcon, PencilIcon, KeyRoundIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { logout } from "@/lib/auth/actions"
import { ProfileEditModal }    from "./profile-edit-modal"
import { ChangePasswordModal } from "./change-password-modal"

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "Super Administrateur",
  ADMIN:       "Administrateur",
  PRESIDENT:   "Président",
  TRESORIER:   "Trésorier",
  SECRETAIRE:  "Secrétaire",
  MEMBRE:      "Membre",
}

interface UserMenuProps {
  user: { name?: string | null; email?: string | null; role?: string }
  logoutRedirect?: string
}

export function UserMenu({ user, logoutRedirect }: UserMenuProps) {
  const [modal, setModal] = useState<"profile" | "password" | null>(null)
  const logoutAction = logout.bind(null, logoutRedirect ?? "/login")

  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "?"

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="relative size-8 rounded-full p-0" />}>
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                {user.role && (
                  <p className="text-xs leading-none text-muted-foreground mt-0.5">
                    {roleLabels[user.role] ?? user.role}
                  </p>
                )}
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setModal("profile")}>
              <PencilIcon className="mr-2 size-4" />
              Modifier le profil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModal("password")}>
              <KeyRoundIcon className="mr-2 size-4" />
              Changer le mot de passe
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={logoutAction}>
              <LogOutIcon className="mr-2 size-4" />
              Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {modal === "profile" && (
        <ProfileEditModal
          user={user}
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)}
        />
      )}

      {modal === "password" && (
        <ChangePasswordModal
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)}
        />
      )}
    </>
  )
}
