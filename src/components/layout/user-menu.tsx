"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { SignOutIcon, PencilSimpleIcon, KeyIcon } from "@phosphor-icons/react/dist/ssr";
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
import { BASE_PATH } from "@/lib/env"
import { ProfileEditModal }    from "./profile-edit-modal"
import { ChangePasswordModal } from "./change-password-modal"

function getRoleLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    SUPER_ADMIN: t("roleLabels.SUPER_ADMIN"),
    ADMIN:       t("roleLabels.ADMIN"),
    PRESIDENT:   t("roleLabels.PRESIDENT"),
    TRESORIER:   t("roleLabels.TRESORIER"),
    SECRETAIRE:  t("roleLabels.SECRETAIRE"),
    MEMBRE:      t("roleLabels.MEMBRE"),
  }
}

interface UserMenuProps {
  user: { name?: string | null; email?: string | null; role?: string }
  logoutRedirect?: string
}

export function UserMenu({ user, logoutRedirect }: UserMenuProps) {
  const t = useTranslations("layout.userMenu")
  const roleLabels = getRoleLabels(t)
  const [modal, setModal] = useState<"profile" | "password" | null>(null)
  const queryClient = useQueryClient()
  const logoutAction = logout.bind(null, `${BASE_PATH}${logoutRedirect ?? "/login"}`)

  // Le QueryClient vit dans le layout racine et ne démonte jamais entre deux
  // sessions (navigation soft via Server Action) — sans ça, les données de
  // l'utilisateur précédent restent affichées jusqu'à un F5.
  function handleLogout() {
    queryClient.clear()
    logoutAction()
  }

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
              <PencilSimpleIcon className="mr-2 size-4" />
              {t("editProfile")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModal("password")}>
              <KeyIcon className="mr-2 size-4" />
              {t("changePassword")}
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <SignOutIcon className="mr-2 size-4" />
              {t("logout")}
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
