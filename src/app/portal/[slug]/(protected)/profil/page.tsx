"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { UserIcon, PhoneIcon, MapPinIcon, CalendarBlankIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { portalFetch } from "@/lib/portal-fetch"
import { ImageUpload } from "@/components/ui/image-upload"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
}

const GROUPE_SANGUIN_LABELS: Record<string, string> = {
  A_POSITIF:  "A+",
  A_NEGATIF:  "A-",
  B_POSITIF:  "B+",
  B_NEGATIF:  "B-",
  AB_POSITIF: "AB+",
  AB_NEGATIF: "AB-",
  O_POSITIF:  "O+",
  O_NEGATIF:  "O-",
}

const CIVILITE_LABELS: Record<string, string> = {
  MME:  "Mme",
  MLLE: "Mlle",
  M:    "M.",
}

const phoneRegex = /^[+\d][\d\s.\-()]{5,19}$/

const schema = z.object({
  phone:     z.string().trim().optional().or(z.literal("")).refine(
    v => !v || phoneRegex.test(v),
    "Numéro de téléphone invalide",
  ),
  address:   z.string().trim().optional().or(z.literal("")),
  birthDate: z.string().optional().or(z.literal("")).refine(
    v => !v || new Date(v) < new Date(),
    "La date de naissance doit être dans le passé",
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
})
type FormValues = z.infer<typeof schema>

const statusLabel: Record<string, string> = {
  PENDING:  "En attente de validation",
  ACTIF:    "Actif",
  INACTIF:  "Inactif",
  SUSPENDU: "Suspendu",
}
const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING:  "outline",
  ACTIF:    "default",
  INACTIF:  "secondary",
  SUSPENDU: "destructive",
}

export default function ProfilPage() {
  const qc = useQueryClient()

  const { data: membre, isLoading } = useQuery<Membre>({
    queryKey: ["portal-profil"],
    queryFn:  () => portalFetch("/api/portal/profil") as Promise<Membre>,
    staleTime: 0,
  })

  const { register, control, handleSubmit, getValues, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    values: membre ? {
      phone:     membre.phone     ?? "",
      address:   membre.address   ?? "",
      birthDate: membre.birthDate ? membre.birthDate.slice(0, 10) : "",
      civilite:      membre.civilite      ?? "",
      groupeSanguin: membre.groupeSanguin ?? "",
      allergies:     membre.allergies     ?? "",
      photoUrl:      membre.photoUrl      ?? "",
    } : undefined,
  })

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const r = await fetch("/api/portal/profil", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    onSuccess: () => {
      toast.success("Profil mis à jour")
      qc.invalidateQueries({ queryKey: ["portal-profil"] })
      qc.invalidateQueries({ queryKey: ["membres"] })
    },
    onError: () => toast.error("Erreur lors de la mise à jour"),
  })

  if (isLoading) {
    return (
      <div className="w-full space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border p-6 space-y-4">
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
          <div className="rounded-xl border p-6 space-y-4">
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
    return <div className="p-8 text-sm text-destructive">Profil introuvable.</div>
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mon profil</h1>
        <p className="text-muted-foreground text-sm mt-1">Vos informations personnelles.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserIcon className="size-4" />
            Identité
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Prénom</p>
            <p className="font-medium">{membre.firstName}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Nom</p>
            <p className="font-medium">{membre.lastName}</p>
          </div>
          <div className="flex mb-2 justify-center">
            <Controller
              name="photoUrl"
              control={control}
              render={({ field }) => (
                <ImageUpload
                  value={field.value ?? ""}
                  onChange={(url) => {
                    field.onChange(url)
                    mutation.mutate({ ...getValues(), photoUrl: url })
                  }}
                  prefix="membres"
                  aspectRatio="square"
                  className="w-24"
                  uploadUrl="/api/portal/upload"
                />
              )}
            />
          </div>
          <div className="grid col-span-2">
            <p className="text-muted-foreground text-xs mb-0.5">Email</p>
            <p className="flex items-center gap-1.5">
              <EnvelopeSimpleIcon className="size-3 text-muted-foreground shrink-0" />
              {membre.email ?? <span className="text-muted-foreground italic">Non renseigné</span>}
            </p>
          </div>
          <div className="flex justify-center gap-1.5">
            <p className="text-muted-foreground text-xs mb-0.5">Statut</p>
            <Badge variant={statusVariant[membre.status]}>{statusLabel[membre.status]}</Badge>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Date de naissance</p>
            <p className="flex items-center gap-1.5">
              <CalendarBlankIcon className="size-3 text-muted-foreground shrink-0" />
              {membre.birthDate
                ? new Date(membre.birthDate).toLocaleDateString("fr-FR")
                : <span className="text-muted-foreground italic">Non renseignée</span>
              }
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coordonnées &amp; informations</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="flex items-center gap-1.5">
                <PhoneIcon className="size-3.5" /> Téléphone
              </Label>
              <Input id="phone" type="tel" placeholder="+33 6 00 00 00 00" {...register("phone")} />
              {errors.phone && <p className="text-destructive text-xs">{errors.phone.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="birthDate" className="flex items-center gap-1.5">
                <CalendarBlankIcon className="size-3.5" /> Date de naissance
              </Label>
              <Input id="birthDate" type="date" max={new Date().toISOString().split("T")[0]} {...register("birthDate")} />
              {errors.birthDate && <p className="text-destructive text-xs">{errors.birthDate.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address" className="flex items-center gap-1.5">
                <MapPinIcon className="size-3.5" /> Adresse
              </Label>
              <Input id="address" placeholder="123 rue de la Paix, Paris" {...register("address")} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="civilite"
                control={control}
                render={({ field }) => (
                  <div className="space-y-1.5">
                    <Label>Civilité</Label>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Non renseigné">
                          {field.value ? CIVILITE_LABELS[field.value] : "Non renseigné"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Non renseigné</SelectItem>
                        <SelectItem value="MME">Mme</SelectItem>
                        <SelectItem value="MLLE">Mlle</SelectItem>
                        <SelectItem value="M">M.</SelectItem>
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
                    <Label>Groupe sanguin</Label>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Non renseigné">
                          {field.value ? GROUPE_SANGUIN_LABELS[field.value] : "Non renseigné"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Non renseigné</SelectItem>
                        <SelectItem value="A_POSITIF">A+</SelectItem>
                        <SelectItem value="A_NEGATIF">A-</SelectItem>
                        <SelectItem value="B_POSITIF">B+</SelectItem>
                        <SelectItem value="B_NEGATIF">B-</SelectItem>
                        <SelectItem value="AB_POSITIF">AB+</SelectItem>
                        <SelectItem value="AB_NEGATIF">AB-</SelectItem>
                        <SelectItem value="O_POSITIF">O+</SelectItem>
                        <SelectItem value="O_NEGATIF">O-</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="allergies">Allergies connues</Label>
              <Input id="allergies" placeholder="Arachides, pollen…" {...register("allergies")} />
              {errors.allergies && <p className="text-destructive text-xs">{errors.allergies.message}</p>}
            </div>

            <Button type="submit" disabled={!isDirty || mutation.isPending} className="w-full">
              {mutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
