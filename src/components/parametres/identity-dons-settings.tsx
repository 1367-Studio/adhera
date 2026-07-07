"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"
import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { ORGANISME_CATEGORY_GROUPS } from "@/lib/organisme-category"

type OrganismeCategory = typeof ORGANISME_CATEGORY_GROUPS[number]["options"][number]["value"]

type IdentityData = {
  address:            string | null
  phone:              string | null
  siren:              string | null
  rna:                string | null
  canIssueTaxReceipts: boolean
  objet:              string | null
  organismeCategory:  OrganismeCategory
  organismeCategoryDetail: string | null
}

interface IdentityDonsSettingsProps {
  canEdit: boolean
}

export function IdentityDonsSettings({ canEdit }: IdentityDonsSettingsProps) {
  const qc = useQueryClient()

  const { data } = useQuery<IdentityData>({
    queryKey: ["association-identity"],
    queryFn:  () => fetch("/api/association/identity").then(r => r.json()),
  })

  const [address, setAddress]                       = useState("")
  const [phone, setPhone]                           = useState("")
  const [siren, setSiren]                           = useState("")
  const [rna, setRna]                               = useState("")
  const [canIssueTaxReceipts, setCanIssueTaxReceipts] = useState(false)
  const [objet, setObjet]                           = useState("")
  const [organismeCategory, setOrganismeCategory]   = useState<OrganismeCategory>("ASSOCIATION_LOI_1901")
  const [organismeCategoryDetail, setOrganismeCategoryDetail] = useState("")
  const [dirty, setDirty]                           = useState(false)

  useEffect(() => {
    if (!data) return
    setAddress(data.address ?? "")
    setPhone(data.phone ?? "")
    setSiren(data.siren ?? "")
    setRna(data.rna ?? "")
    setCanIssueTaxReceipts(data.canIssueTaxReceipts)
    setObjet(data.objet ?? "")
    setOrganismeCategory(data.organismeCategory ?? "ASSOCIATION_LOI_1901")
    setOrganismeCategoryDetail(data.organismeCategoryDetail ?? "")
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/identity", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          address, phone, siren, rna, canIssueTaxReceipts,
          objet, organismeCategory, organismeCategoryDetail,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erreur")
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["association-identity"] })
      toast.success("Identité mise à jour")
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  const hasIdentifier = siren.trim() !== "" || rna.trim() !== ""

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Identité légale & Dons</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Informations requises pour l'émission des reçus fiscaux (Cerfa 11580).
        </p>
      </div>

      <div className="space-y-3">
        <FormField
          label="Adresse complète"
          placeholder="12 rue de la Paix, 75001 Paris"
          disabled={!canEdit}
          value={address}
          onChange={e => { setAddress(e.target.value); setDirty(true) }}
        />
        <FormField
          label="Téléphone"
          placeholder="01 23 45 67 89"
          disabled={!canEdit}
          value={phone}
          onChange={e => { setPhone(e.target.value); setDirty(true) }}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="SIREN / SIRET"
            placeholder="123456789"
            disabled={!canEdit}
            value={siren}
            onChange={e => { setSiren(e.target.value.replace(/\D/g, "")); setDirty(true) }}
            maxLength={14}
          />
          <FormField
            label="Numéro RNA"
            placeholder="W751234567"
            disabled={!canEdit}
            value={rna}
            onChange={e => { setRna(e.target.value); setDirty(true) }}
          />
        </div>

        <FormField
          label="Objet de l'association"
          placeholder="Ex : promotion du sport amateur auprès des jeunes"
          disabled={!canEdit}
          value={objet}
          onChange={e => { setObjet(e.target.value); setDirty(true) }}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Catégorie de l'organisme
          </label>
          <select
            disabled={!canEdit}
            value={organismeCategory}
            onChange={e => { setOrganismeCategory(e.target.value as OrganismeCategory); setDirty(true) }}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400"
          >
            {ORGANISME_CATEGORY_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Catégorie cochée sur les reçus fiscaux (Cerfa 11580 / 16216), utilisée pour les dons d'entreprises.
          </p>
        </div>

        <FormField
          label="Précisions sur la catégorie (optionnel)"
          placeholder="Ex : date de reconnaissance d'utilité publique"
          disabled={!canEdit}
          value={organismeCategoryDetail}
          onChange={e => { setOrganismeCategoryDetail(e.target.value); setDirty(true) }}
        />
      </div>

      {/* Toggle reçu fiscal */}
      <div className="rounded-lg border p-4 space-y-3">
        <label className={`flex items-start gap-3 ${canEdit ? "cursor-pointer" : "cursor-default"}`}>
          <input
            type="checkbox"
            checked={canIssueTaxReceipts}
            disabled={!canEdit || (!hasIdentifier && !canIssueTaxReceipts)}
            onChange={e => { setCanIssueTaxReceipts(e.target.checked); setDirty(true) }}
            className="mt-0.5 rounded border-input accent-violet-600"
          />
          <div>
            <p className="text-sm font-medium">Émettre des reçus fiscaux</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Notre association est reconnue d'intérêt général (Art. 200 CGI) et habilitée
              à délivrer des reçus fiscaux permettant une réduction d'impôt de 66 % à 75 %.
            </p>
          </div>
        </label>

        {!hasIdentifier && !canIssueTaxReceipts && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
            <span>Ajoutez un numéro SIREN ou RNA pour pouvoir activer cette option.</span>
          </div>
        )}

        {canIssueTaxReceipts && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
            <span>
              Les reçus fiscaux seront envoyés automatiquement par e-mail après chaque don
              et disponibles au téléchargement dans l'espace membre.
              Conservation obligatoire : 6 ans minimum.
            </span>
          </div>
        )}

        {canIssueTaxReceipts && !objet.trim() && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
            <span>
              Vérifiez l'Objet et la Catégorie de l'organisme ci-dessus avant de recevoir des dons
              d'entreprises : ils sont imprimés sur le reçu fiscal (Cerfa 16216) et le défaut
              « Association loi 1901 » peut ne pas correspondre à votre situation.
            </span>
          </div>
        )}
      </div>

      {canEdit && (
        <Button
          size="sm"
          disabled={!dirty}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Enregistrer
        </Button>
      )}
    </div>
  )
}
