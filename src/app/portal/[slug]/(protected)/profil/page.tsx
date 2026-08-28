"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { UserIcon, PhoneIcon, MapPinIcon, CalendarBlankIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { portalFetch } from "@/lib/portal-fetch"
import { ImageUpload } from "@/components/ui/image-upload"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales"

type Membre = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  phone:     string | null
  address:   string | null
  birthDate: string | null
  status:    "PENDING" | "ACTIF" | "INACTIF" | "SUSPENDU"
  civilite:      "MME" | "MLLE" | "M" | null
  groupeSanguin: "A_POSITIF" | "A_NEGATIF" | "B_POSITIF" | "B_NEGATIF" | "AB_POSITIF" | "AB_NEGATIF" | "O_POSITIF" | "O_NEGATIF" | null
  allergies:     string | null
  photoUrl:      string | null
  preferredLocale: string | null
  possedeTshirt: boolean | null
  tailleTshirt:  "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL" | null
}

const phoneRegex = /^[+\d][\d\s.\-()]{5,19}$/

function buildSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    phone:     z.string().trim().optional().or(z.literal("")).refine(
      v => !v || phoneRegex.test(v),
      t("contact.phoneInvalid"),
    ),
    address:   z.string().trim().optional().or(z.literal("")),
    birthDate: z.string().optional().or(z.literal("")).refine(
      v => !v || new Date(v) < new Date(),
      t("contact.birthDateInPast"),
    ),
    civilite:      z.enum(["MME", "MLLE", "M"]).optional().or(z.literal("")),
    groupeSanguin: z.enum([
      "A_POSITIF", "A_NEGATIF",
      "B_POSITIF", "B_NEGATIF",
      "AB_POSITIF", "AB_NEGATIF",
      "O_POSITIF", "O_NEGATIF",
    ]).optional().or(z.literal("")),
    allergies: z.string().trim().optional().or(z.literal("")),
    photoUrl:  z.string().trim().optional().or(z.literal("")),
    preferredLocale: z.enum(["fr", "en", "pt", "pt-PT", "es"]).optional().or(z.literal("")),
    possedeTshirt: z.enum(["true", "false"]).optional().or(z.literal("")),
    tailleTshirt:  z.enum(["XS", "S", "M", "L", "XL", "XXL", "XXXL"]).optional().or(z.literal("")),
  })
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING:  "outline",
  ACTIF:    "default",
  INACTIF:  "secondary",
  SUSPENDU: "destructive",
}

function getGroupeSanguinLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    A_POSITIF:  t("groupeSanguinLabels.A_POSITIF"),
    A_NEGATIF:  t("groupeSanguinLabels.A_NEGATIF"),
    B_POSITIF:  t("groupeSanguinLabels.B_POSITIF"),
    B_NEGATIF:  t("groupeSanguinLabels.B_NEGATIF"),
    AB_POSITIF: t("groupeSanguinLabels.AB_POSITIF"),
    AB_NEGATIF: t("groupeSanguinLabels.AB_NEGATIF"),
    O_POSITIF:  t("groupeSanguinLabels.O_POSITIF"),
    O_NEGATIF:  t("groupeSanguinLabels.O_NEGATIF"),
  }
}

function getCiviliteLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    MME:  t("civiliteLabels.MME"),
    MLLE: t("civiliteLabels.MLLE"),
    M:    t("civiliteLabels.M"),
  }
}

function getStatusLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    PENDING:  t("statusLabel.PENDING"),
    ACTIF:    t("statusLabel.ACTIF"),
    INACTIF:  t("statusLabel.INACTIF"),
    SUSPENDU: t("statusLabel.SUSPENDU"),
  }
}

export default function ProfilPage() {
  const t = useTranslations("portalMembre.profil")
  const qc = useQueryClient()
  const [removePhotoOpen, setRemovePhotoOpen] = useState(false)

  const GROUPE_SANGUIN_LABELS = getGroupeSanguinLabels(t)
  const CIVILITE_LABELS = getCiviliteLabels(t)
  const statusLabel = getStatusLabels(t)

  const { data: membre, isLoading } = useQuery<Membre>({
    queryKey: ["portal-profil"],
    queryFn:  () => portalFetch("/api/portal/profil") as Promise<Membre>,
    staleTime: 0,
  })

  const { register, control, handleSubmit, setValue, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver:      zodResolver(buildSchema(t)),
    values: membre ? {
      phone:     membre.phone     ?? "",
      address:   membre.address   ?? "",
      birthDate: membre.birthDate ? membre.birthDate.slice(0, 10) : "",
      civilite:      membre.civilite      ?? "",
      groupeSanguin: membre.groupeSanguin ?? "",
      allergies:     membre.allergies     ?? "",
      photoUrl:      membre.photoUrl      ?? "",
      preferredLocale: (membre.preferredLocale ?? "") as FormValues["preferredLocale"],
      possedeTshirt: membre.possedeTshirt === null ? "" : String(membre.possedeTshirt) as "true" | "false",
      tailleTshirt:  membre.tailleTshirt  ?? "",
    } : undefined,
  })

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const r = await fetch("/api/portal/profil", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    onSuccess: () => {
      toast.success(t("toasts.updated"))
      qc.invalidateQueries({ queryKey: ["portal-profil"] })
      qc.invalidateQueries({ queryKey: ["membres"] })
    },
    onError: () => toast.error(t("toasts.updateError")),
  })

  // Kept separate from `mutation`: the photo saves itself the moment it's picked, so it
  // must never carry along whatever the member happens to be mid-typing (and hasn't
  // validated/submitted yet) in the rest of the form.
  const photoMutation = useMutation({
    mutationFn: async (photoUrl: string) => {
      const r = await fetch("/api/portal/profil", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoUrl }) })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    onSuccess: () => {
      toast.success(t("toasts.photoUpdated"))
      qc.invalidateQueries({ queryKey: ["portal-profil"] })
      qc.invalidateQueries({ queryKey: ["membres"] })
    },
    onError: () => toast.error(t("toasts.photoUpdateError")),
  })

  function handlePhotoChange(url: string) {
    if (!url) {
      setRemovePhotoOpen(true)
      return
    }
    setValue("photoUrl", url)
    photoMutation.mutate(url)
  }

  async function confirmRemovePhoto() {
    await photoMutation.mutateAsync("")
    setValue("photoUrl", "")
    setRemovePhotoOpen(false)
  }

  if (isLoading) {
    return (
      <div className="w-full space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border p-6 space-y-4">
            <div className="h-5 w-24 rounded bg-muted" />
            <div className="grid grid-cols-2 gap-4">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-16 rounded bg-muted" />
                  <div className="h-5 w-24 rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border p-6 space-y-4">
            <div className="h-5 w-40 rounded bg-muted" />
            {[0, 1, 2].map(i => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-9 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!membre) {
    return <div className="p-8 text-sm text-destructive">{t("notFound")}</div>
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserIcon className="size-4" />
            {t("identity.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">{t("identity.firstName")}</p>
            <p className="font-medium">{membre.firstName}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">{t("identity.lastName")}</p>
            <p className="font-medium">{membre.lastName}</p>
          </div>
          <div className="flex mb-2 justify-center">
            <Controller
              name="photoUrl"
              control={control}
              render={({ field }) => (
                <ImageUpload
                  value={field.value ?? ""}
                  onChange={handlePhotoChange}
                  prefix="membres"
                  aspectRatio="square"
                  className="w-24"
                  uploadUrl="/api/portal/upload"
                  compact
                />
              )}
            />
          </div>
          <div className="grid col-span-2">
            <p className="text-muted-foreground text-xs mb-0.5">{t("identity.email")}</p>
            <p className="flex items-center gap-1.5">
              <EnvelopeSimpleIcon className="size-3 text-muted-foreground shrink-0" />
              {membre.email ?? <span className="text-muted-foreground italic">{t("identity.notProvided")}</span>}
            </p>
          </div>
          <div className="flex justify-center gap-1.5">
            <p className="text-muted-foreground text-xs mb-0.5">{t("identity.status")}</p>
            <Badge variant={statusVariant[membre.status]}>{statusLabel[membre.status]}</Badge>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">{t("identity.birthDate")}</p>
            <p className="flex items-center gap-1.5">
              <CalendarBlankIcon className="size-3 text-muted-foreground shrink-0" />
              {membre.birthDate
                ? new Date(membre.birthDate).toLocaleDateString("fr-FR")
                : <span className="text-muted-foreground italic">{t("identity.notProvidedFem")}</span>
              }
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("contact.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="flex items-center gap-1.5">
                <PhoneIcon className="size-3.5" /> {t("contact.phone")}
              </Label>
              <Input id="phone" type="tel" placeholder={t("contact.phonePlaceholder")} {...register("phone")} />
              {errors.phone && <p className="text-destructive text-xs">{errors.phone.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="birthDate" className="flex items-center gap-1.5">
                <CalendarBlankIcon className="size-3.5" /> {t("contact.birthDate")}
              </Label>
              <Input id="birthDate" type="date" max={new Date().toISOString().split("T")[0]} {...register("birthDate")} />
              {errors.birthDate && <p className="text-destructive text-xs">{errors.birthDate.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address" className="flex items-center gap-1.5">
                <MapPinIcon className="size-3.5" /> {t("contact.address")}
              </Label>
              <Input id="address" placeholder={t("contact.addressPlaceholder")} {...register("address")} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="civilite"
                control={control}
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>{t("contact.civilite")}</Label>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("contact.notProvided")}>
                          {field.value ? CIVILITE_LABELS[field.value] : t("contact.notProvided")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("contact.notProvided")}</SelectItem>
                        <SelectItem value="MME">{CIVILITE_LABELS.MME}</SelectItem>
                        <SelectItem value="MLLE">{CIVILITE_LABELS.MLLE}</SelectItem>
                        <SelectItem value="M">{CIVILITE_LABELS.M}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />

              <Controller
                name="groupeSanguin"
                control={control}
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>{t("contact.groupeSanguin")}</Label>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("contact.notProvided")}>
                          {field.value ? GROUPE_SANGUIN_LABELS[field.value] : t("contact.notProvided")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("contact.notProvided")}</SelectItem>
                        <SelectItem value="A_POSITIF">{GROUPE_SANGUIN_LABELS.A_POSITIF}</SelectItem>
                        <SelectItem value="A_NEGATIF">{GROUPE_SANGUIN_LABELS.A_NEGATIF}</SelectItem>
                        <SelectItem value="B_POSITIF">{GROUPE_SANGUIN_LABELS.B_POSITIF}</SelectItem>
                        <SelectItem value="B_NEGATIF">{GROUPE_SANGUIN_LABELS.B_NEGATIF}</SelectItem>
                        <SelectItem value="AB_POSITIF">{GROUPE_SANGUIN_LABELS.AB_POSITIF}</SelectItem>
                        <SelectItem value="AB_NEGATIF">{GROUPE_SANGUIN_LABELS.AB_NEGATIF}</SelectItem>
                        <SelectItem value="O_POSITIF">{GROUPE_SANGUIN_LABELS.O_POSITIF}</SelectItem>
                        <SelectItem value="O_NEGATIF">{GROUPE_SANGUIN_LABELS.O_NEGATIF}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="possedeTshirt"
                control={control}
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>{t("contact.possedeTshirt")}</Label>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={v => {
                        const next = v === "__none__" ? "" : v
                        field.onChange(next)
                        // A size doesn't make sense once "does not have a t-shirt" is
                        // selected — clear it so the two fields can't contradict each other.
                        if (next === "false") setValue("tailleTshirt", "", { shouldDirty: true })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("contact.notProvided")}>
                          {field.value === "true" ? t("contact.yes") : field.value === "false" ? t("contact.no") : t("contact.notProvided")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("contact.notProvided")}</SelectItem>
                        <SelectItem value="true">{t("contact.yes")}</SelectItem>
                        <SelectItem value="false">{t("contact.no")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />

              <Controller
                name="tailleTshirt"
                control={control}
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>{t("contact.tailleTshirt")}</Label>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("contact.notProvided")}>
                          {field.value || t("contact.notProvided")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("contact.notProvided")}</SelectItem>
                        <SelectItem value="XS">XS</SelectItem>
                        <SelectItem value="S">S</SelectItem>
                        <SelectItem value="M">M</SelectItem>
                        <SelectItem value="L">L</SelectItem>
                        <SelectItem value="XL">XL</SelectItem>
                        <SelectItem value="XXL">XXL</SelectItem>
                        <SelectItem value="XXXL">XXXL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="allergies">{t("contact.allergies")}</Label>
              <Textarea id="allergies" rows={2} placeholder={t("contact.allergiesPlaceholder")} {...register("allergies")} />
              {errors.allergies && <p className="text-destructive text-xs">{errors.allergies.message}</p>}
            </div>

            <Controller
              name="preferredLocale"
              control={control}
              render={({ field }) => (
                <div className="space-y-1.5">
                  <Label>{t("contact.preferredLocale")}</Label>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("contact.notProvided")}>
                        {field.value ? LOCALE_LABELS[field.value as Locale] : t("contact.notProvided")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("contact.notProvided")}</SelectItem>
                      {SUPPORTED_LOCALES.map(code => (
                        <SelectItem key={code} value={code}>{LOCALE_LABELS[code]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            />

            <Button type="submit" disabled={!isDirty || mutation.isPending} className="w-full">
              {mutation.isPending ? t("contact.saving") : t("contact.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
      </div>

      <ConfirmDialog
        open={removePhotoOpen}
        onOpenChange={setRemovePhotoOpen}
        title={t("removePhoto.title")}
        description={t("removePhoto.description")}
        confirmLabel={t("removePhoto.confirm")}
        loading={photoMutation.isPending}
        onConfirm={confirmRemovePhoto}
      />
    </div>
  )
}
