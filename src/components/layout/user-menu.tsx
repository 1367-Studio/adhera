"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { SignOutIcon, PencilSimpleIcon, KeyIcon, ShieldCheckIcon, ScalesIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { logout } from "@/lib/auth/actions"
import { BASE_PATH } from "@/lib/env"
import { ProfileEditModal }        from "./profile-edit-modal"
import { ChangePasswordModal }     from "./change-password-modal"
import { TwoFactorSettingsModal }  from "./two-factor-settings-modal"

// Adhera runs embedded under formwise.fr/app — these legal pages live on the parent
// formwise-app site itself (single platform-wide set, not per-association), so we link
// out instead of duplicating the content here. They sit in this menu rather than in
// Paramètres so every role reaches them: managers, portal members and super admins.
const LEGAL_LINKS = [
  { key: "mentionsLegales",             href: "https://www.formwise.fr/mentions-legales" },
  { key: "cgu",                         href: "https://www.formwise.fr/cgu" },
  { key: "cgs",                         href: "https://www.formwise.fr/cgv" },
  { key: "politiqueConfidentialite",    href: "https://www.formwise.fr/politique-de-confidentialite" },
] as const

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
  const [modal, setModal] = useState<"profile" | "password" | "security" | null>(null)
  // 2FA is staff-only for now — the portal's member-facing dropdown reuses this same
  // component, so it needs an explicit gate rather than relying on the action layer alone.
  const isStaff = user.role !== "MEMBRE"
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
            {isStaff && (
              <DropdownMenuItem onClick={() => setModal("security")}>
                <ShieldCheckIcon className="mr-2 size-4" />
                {t("security")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ScalesIcon className="mr-2 size-4" />
                {t("legalDocuments.title")}
              </DropdownMenuSubTrigger>
              {/* No side/align override: as a submenu, Base UI's positioner flips it to the
                  left when the right edge is too close, then drops it below the trigger and
                  shifts it back inside the viewport when neither side fits (phones). */}
              <DropdownMenuSubContent>
                {LEGAL_LINKS.map(legalLink => (
                  // A real <a> (middle-click, copy link, status bar URL) rather than
                  // window.open; Menu.Item still closes the menu on click, which
                  // Menu.LinkItem wouldn't by default.
                  <DropdownMenuItem
                    key={legalLink.key}
                    render={<a href={legalLink.href} target="_blank" rel="noopener noreferrer" />}
                  >
                    <span className="flex-1">{t(`legalDocuments.${legalLink.key}`)}</span>
                    <ArrowSquareOutIcon className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="sr-only">{t("legalDocuments.opensNewTab")}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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

      {modal === "security" && (
        <TwoFactorSettingsModal onClose={() => setModal(null)} />
      )}
    </>
  )
}
