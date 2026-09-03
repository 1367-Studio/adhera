import { useQuery } from "@tanstack/react-query"

export type MembershipTierOption = { id: string; label: string; amount: number; formTitle: string }

// Tarifs proposables dans le modal d'ajout de membre (voir GET /api/membership-forms/
// tier-options) — un échec (module cotisations off, rôle insuffisant) rend simplement une
// liste vide : le sélecteur ne s'affiche pas, ce n'est jamais bloquant pour créer le membre.
async function fetchTierOptions(): Promise<MembershipTierOption[]> {
  const res = await fetch("/api/membership-forms/tier-options")
  if (!res.ok) return []
  const data = await res.json()
  return data.tiers ?? []
}

export function useMembershipTierOptions(enabled: boolean) {
  return useQuery({ queryKey: ["membership-tier-options"], queryFn: fetchTierOptions, enabled })
}

export type MembershipFillForm = { id: string; title: string; slug: string }

// Formulaires publiés qu'un gestionnaire peut remplir à la place d'un adhérent (mode admin
// du formulaire public) — alimente le menu « Ajouter » de la page Membres. Même convention
// d'échec silencieux que fetchTierOptions ci-dessus.
async function fetchFillForms(): Promise<MembershipFillForm[]> {
  const res = await fetch("/api/membership-forms/fill-options")
  if (!res.ok) return []
  const data = await res.json()
  return data.forms ?? []
}

export function useMembershipFillForms(enabled: boolean) {
  return useQuery({ queryKey: ["membership-fill-forms"], queryFn: fetchFillForms, enabled })
}
