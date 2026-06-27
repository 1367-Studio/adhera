"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { UserIcon, PhoneIcon, MapPinIcon, CalendarIcon, MailIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { portalFetch } from "@/lib/portal-fetch"

type Membre = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  phone:     string | null
  address:   string | null
  birthDate: string | null
  status:    "PENDING" | "ACTIF" | "INACTIF" | "SUSPENDU"
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

  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    values: membre ? {
      phone:     membre.phone     ?? "",
      address:   membre.address   ?? "",
      birthDate: membre.birthDate ? membre.birthDate.slice(0, 10) : "",
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
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Prénom</p>
            <p className="font-medium">{membre.firstName}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Nom</p>
            <p className="font-medium">{membre.lastName}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Email</p>
            <p className="flex items-center gap-1.5">
              <MailIcon className="size-3 text-muted-foreground" />
              {membre.email ?? <span className="text-muted-foreground italic">Non renseigné</span>}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Date de naissance</p>
            <p className="flex items-center gap-1.5">
              <CalendarIcon className="size-3 text-muted-foreground" />
              {membre.birthDate
                ? new Date(membre.birthDate).toLocaleDateString("fr-FR")
                : <span className="text-muted-foreground italic">Non renseignée</span>
              }
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Statut</p>
            <Badge variant={statusVariant[membre.status]}>{statusLabel[membre.status]}</Badge>
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
                <CalendarIcon className="size-3.5" /> Date de naissance
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
