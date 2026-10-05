"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { SelectField } from "@/components/ui/select-field"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCurrentUser } from "@/lib/user-context"
import {
  ACCESS_AREAS, ROLE_PROFILES, isStaffRole,
  type AccessArea, type AccessLevel, type ResolvedPermissions,
} from "@/lib/permissions"
import {
  useTeamAccess, useUpdateTeamMember,
  type TeamAssignableRole, type TeamMember, type TeamMemberUpdate,
} from "@/hooks/use-team-access"

type Translator = ReturnType<typeof useTranslations>
type AccessProfile = "administrator" | "role" | "custom"

const ROLE_OPTION_ORDER: TeamAssignableRole[] = ["MEMBRE", "EQUIPE", "SECRETAIRE", "TRESORIER", "PRESIDENT", "ADMIN"]

const ROLE_MESSAGE_KEYS: Record<TeamAssignableRole, string> = {
  MEMBRE:     "membre",
  EQUIPE:     "equipe",
  SECRETAIRE: "secretaire",
  TRESORIER:  "tresorier",
  PRESIDENT:  "president",
  ADMIN:      "admin",
}

function roleLabel(translate: Translator, role: TeamAssignableRole): string {
  return translate(`membres.form.role.${ROLE_MESSAGE_KEYS[role]}`)
}

function allAreasAt(level: AccessLevel): ResolvedPermissions["areas"] {
  return Object.fromEntries(ACCESS_AREAS.map(area => [area, level])) as ResolvedPermissions["areas"]
}

const ADMINISTRATOR_PERMISSIONS: ResolvedPermissions = { administrator: true, areas: allAreasAt("edit") }

function accessSummary(translate: Translator, permissions: ResolvedPermissions): string {
  if (permissions.administrator) return translate("parametres.teamAccess.summary.administrator")
  const editCount = ACCESS_AREAS.filter(area => permissions.areas[area] === "edit").length
  const readCount = ACCESS_AREAS.filter(area => permissions.areas[area] === "read").length
  if (editCount > 0 && readCount > 0) return translate("parametres.teamAccess.summary.editAndRead", { edit: editCount, read: readCount })
  if (editCount > 0) return translate("parametres.teamAccess.summary.editOnly", { edit: editCount })
  if (readCount > 0) return translate("parametres.teamAccess.summary.readOnly", { read: readCount })
  return translate("parametres.teamAccess.summary.none")
}

export function TeamAccessSettings() {
  const translate                       = useTranslations()
  const currentUser                     = useCurrentUser()
  const { data: teamMembers = [], isLoading } = useTeamAccess()
  const [editedMember, setEditedMember] = useState<TeamMember | null>(null)

  // Only the ADMIN role may touch an ADMIN (same rule as the API, src/lib/team-access.ts).
  const canEditMember = (member: TeamMember) =>
    member.userId !== currentUser.id && (member.role !== "ADMIN" || currentUser.role === "ADMIN")

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{translate("parametres.teamAccess.title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{translate("parametres.teamAccess.description")}</p>
        <p className="text-xs text-muted-foreground mt-2">{translate("parametres.teamAccess.howToAdd")}</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(index => <div key={index} className="h-10 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : teamMembers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{translate("parametres.teamAccess.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
              <TableHead>{translate("parametres.teamAccess.columns.name")}</TableHead>
              <TableHead>{translate("parametres.teamAccess.columns.role")}</TableHead>
              <TableHead>{translate("parametres.teamAccess.columns.access")}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamMembers.map(member => (
              <TableRow key={member.userId}>
                <TableCell>
                  <div className="font-medium">{member.name}</div>
                  <div className="text-xs text-muted-foreground">{member.email}</div>
                </TableCell>
                <TableCell>{roleLabel(translate, member.role)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {accessSummary(translate, member.permissions)}
                  {member.isCustom && ` · ${translate("parametres.teamAccess.profiles.custom")}`}
                </TableCell>
                <TableCell className="text-right">
                  {member.userId === currentUser.id ? (
                    <span className="text-xs text-muted-foreground">{translate("parametres.teamAccess.you")}</span>
                  ) : canEditMember(member) ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditedMember(member)}>
                      {translate("common.edit")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editedMember && (
        <TeamMemberAccessModal
          key={editedMember.userId}
          member={editedMember}
          canGrantAdminRole={currentUser.role === "ADMIN"}
          onClose={() => setEditedMember(null)}
        />
      )}
    </div>
  )
}

function initialProfile(member: TeamMember): AccessProfile {
  if (!member.isCustom) return "role"
  return member.permissions.administrator ? "administrator" : "custom"
}

function TeamMemberAccessModal({
  member,
  canGrantAdminRole,
  onClose,
}: {
  member:            TeamMember
  canGrantAdminRole: boolean
  onClose:           () => void
}) {
  const translate                         = useTranslations()
  const updateMutation                    = useUpdateTeamMember()
  const [role, setRole]                   = useState<TeamAssignableRole>(member.role)
  const [profile, setProfile]             = useState<AccessProfile>(() => initialProfile(member))
  const [customPermissions, setCustomPermissions] = useState<ResolvedPermissions>(member.permissions)

  const roleOptions = ROLE_OPTION_ORDER
    .filter(roleOption => roleOption !== "ADMIN" || canGrantAdminRole)
    .map(roleOption => ({ value: roleOption, label: roleLabel(translate, roleOption) }))

  const profileOptions: { value: AccessProfile; label: string }[] = [
    { value: "administrator", label: translate("parametres.teamAccess.profiles.administrator") },
    { value: "role",          label: translate("parametres.teamAccess.profiles.role") },
    { value: "custom",        label: translate("parametres.teamAccess.profiles.custom") },
  ]

  const levelOptions: { value: AccessLevel; label: string }[] = [
    { value: "none", label: translate("parametres.teamAccess.levels.none") },
    { value: "read", label: translate("parametres.teamAccess.levels.read") },
    { value: "edit", label: translate("parametres.teamAccess.levels.edit") },
  ]

  // MEMBRE has no dashboard; ADMIN is always an administrator — neither has access to tune.
  const hasTunableAccess = role !== "MEMBRE" && role !== "ADMIN" && isStaffRole(role)

  const effectivePermissions: ResolvedPermissions =
    profile === "administrator" ? ADMINISTRATOR_PERMISSIONS
    : profile === "role" && isStaffRole(role) ? ROLE_PROFILES[role]
    : customPermissions

  function handleProfileChange(nextProfile: AccessProfile) {
    // Starting a custom profile from what is shown keeps the grid where the user sees it.
    if (nextProfile === "custom") setCustomPermissions({ ...effectivePermissions, administrator: false })
    setProfile(nextProfile)
  }

  function handleAreaChange(area: AccessArea, level: AccessLevel) {
    setCustomPermissions({ administrator: false, areas: { ...effectivePermissions.areas, [area]: level } })
    setProfile("custom")
  }

  function handleAdministratorChange(isAdministrator: boolean) {
    if (isAdministrator) {
      setProfile("administrator")
      return
    }
    // effectivePermissions.areas is all "edit" while profile is "administrator" — carrying
    // that over here would turn off the switch but silently keep full edit access everywhere,
    // which looks like a downgrade and isn't one. Start from a clean slate instead.
    setCustomPermissions({ administrator: false, areas: allAreasAt("none") })
    setProfile("custom")
  }

  async function handleSave() {
    const update: TeamMemberUpdate = { role }
    if (hasTunableAccess) {
      update.permissions = profile === "role"
        ? null
        : { administrator: effectivePermissions.administrator, areas: effectivePermissions.areas }
    }
    try {
      await updateMutation.mutateAsync({ userId: member.userId, update })
      toast.success(translate("parametres.teamAccess.toasts.saved"))
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : translate("common.error"))
    }
  }

  return (
    <Modal
      open
      onOpenChange={isOpen => { if (!isOpen) onClose() }}
      title={translate("parametres.teamAccess.editTitle")}
      description={translate("parametres.teamAccess.editDescription", { name: member.name })}
      size="2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>{translate("common.cancel")}</Button>
          <Button onClick={handleSave} loading={updateMutation.isPending}>{translate("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="team-access-role"
            label={translate("parametres.teamAccess.roleLabel")}
            options={roleOptions}
            value={role}
            onValueChange={value => setRole(value as TeamAssignableRole)}
          />
          {hasTunableAccess && (
            <SelectField
              id="team-access-profile"
              label={translate("parametres.teamAccess.profileLabel")}
              options={profileOptions}
              value={profile}
              onValueChange={value => handleProfileChange(value as AccessProfile)}
            />
          )}
        </div>

        {role === "MEMBRE" && (
          <p className="text-sm text-muted-foreground">{translate("parametres.teamAccess.memberRoleHint")}</p>
        )}
        {role === "ADMIN" && (
          <p className="text-sm text-muted-foreground">{translate("parametres.teamAccess.adminRoleHint")}</p>
        )}

        {hasTunableAccess && (
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{translate("parametres.teamAccess.administratorSwitch")}</span>
              <Switch
                checked={effectivePermissions.administrator}
                onCheckedChange={checked => handleAdministratorChange(checked)}
              />
            </label>

            <div>
              <p className="text-sm font-medium">{translate("parametres.teamAccess.areasLabel")}</p>
              {effectivePermissions.administrator && (
                <p className="text-xs text-muted-foreground mt-0.5">{translate("parametres.teamAccess.administratorHint")}</p>
              )}
              <ul className="mt-2 divide-y border-y">
                {ACCESS_AREAS.map(area => {
                  const areaLabel = translate(`parametres.teamAccess.areas.${area}`)
                  return (
                    <li key={area} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span className="text-sm">{areaLabel}</span>
                      <SegmentedControl
                        size="sm"
                        className="w-full shrink-0 sm:w-64"
                        ariaLabel={areaLabel}
                        options={levelOptions}
                        value={effectivePermissions.areas[area]}
                        disabled={effectivePermissions.administrator}
                        onChange={level => handleAreaChange(area, level)}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
