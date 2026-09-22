// Une adresse existe sous deux formes en base, et les deux doivent continuer à s'afficher
// exactement pareil pendant des années :
//
//   - structurée : les colonnes issues du découpage du champ adresse (rue, complément,
//     code postal, ville, pays). Tout ce qui est saisi depuis ce découpage.
//   - héritée    : l'unique colonne texte libre `address` utilisée par tous les Membre/
//     Don/Participation créés avant. Elle n'est jamais parsée ni réécrite — un
//     enregistrement qui n'a qu'elle doit s'afficher comme il l'a toujours fait, et c'est
//     précisément le rôle du champ `legacy` ci-dessous.
//
// L'appelant mappe explicitement ses propres colonnes sur AddressInput plutôt que de
// passer une ligne entière, parce que `address` ne veut pas dire la même chose partout :
// sur Membre/Don/Participation c'est l'adresse complète (→ `legacy`), alors que sur
// Association/Fournisseur c'est déjà uniquement la voie (→ `street`), la ville et le code
// postal ayant leurs propres colonnes.
export type AddressInput = {
  street?:     string | null
  complement?: string | null
  postalCode?: string | null
  city?:       string | null
  country?:    string | null
  legacy?:     string | null
}

// Longueur maximale partagée par tous les schémas zod qui acceptent une adresse — les
// colonnes en base sont des TEXT sans contrainte, donc ces valeurs sont la seule barrière
// réelle. Un même champ logique doit accepter la même longueur partout, sinon la même
// colonne physique se retrouve tronquée différemment selon la route qui l'a écrite.
export const ADDRESS_MAX_LENGTHS = {
  street:     300,
  complement: 300,
  postalCode: 20,
  city:       120,
  country:    100,
} as const

function cleanedValue(value?: string | null): string | null {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : null
}

function structuredParts(input: AddressInput) {
  const postalCode = cleanedValue(input.postalCode)
  const city       = cleanedValue(input.city)
  return {
    street:     cleanedValue(input.street),
    complement: cleanedValue(input.complement),
    locality:   [postalCode, city].filter(Boolean).join(" ") || null,
    country:    cleanedValue(input.country),
    postalCode,
    city,
  }
}

// Les lignes d'affichage de l'adresse, dans l'ordre postal français : voie, complément,
// "code postal ville", pays. Le format structuré l'emporte dès qu'au moins une de ses
// parties est renseignée ; sinon on retombe sur le texte libre hérité. Aucune adresse du
// tout → tableau vide, jamais une ligne blanche.
export function formatAddressLines(input: AddressInput): string[] {
  const { street, complement, locality, country } = structuredParts(input)

  // Le pays seul ne fait pas une adresse : un formulaire qui pré-remplit "France" et que
  // personne ne complète ne doit pas transformer une fiche sans adresse en une fiche dont
  // l'adresse est "France". Il faut au moins une voie, un complément ou une localité.
  if (street || complement || locality) {
    return [street, complement, locality, country].filter((line): line is string => line !== null)
  }

  const legacyAddress = cleanedValue(input.legacy)
  return legacyAddress ? [legacyAddress] : []
}

// La même adresse sur une seule ligne, séparée par des virgules — le format utilisé par
// les PDF (reçu fiscal, déclaration), les exports CSV et les fiches membre.
export function formatAddress(input: AddressInput): string | null {
  const lines = formatAddressLines(input)
  return lines.length > 0 ? lines.join(", ") : null
}

// Les colonnes à écrire en base à partir d'un formulaire — le seul endroit qui décide ce
// que contiennent les colonnes structurées ET la colonne héritée. Toutes les routes qui
// enregistrent une adresse passent par ici, pour que la double écriture reste cohérente :
// `address` garde une version lisible de l'adresse, si bien qu'un lecteur pas encore migré
// (un PDF, un export, un futur bout de code distrait) y trouve toujours quelque chose de
// juste. Inversement, un vieil onglet qui ne poste encore que `legacy` continue de
// fonctionner : les colonnes structurées restent nulles, la colonne héritée est remplie.
export type AddressColumns = {
  addressStreet:     string | null
  addressComplement: string | null
  postalCode:        string | null
  city:              string | null
  country:           string | null
  address:           string | null
}

export function addressColumns(input: AddressInput): AddressColumns {
  const { street, complement, locality, country, postalCode, city } = structuredParts(input)
  const hasStructuredAddress = !!(street || complement || locality)

  return {
    addressStreet:     hasStructuredAddress ? street     : null,
    addressComplement: hasStructuredAddress ? complement : null,
    postalCode:        hasStructuredAddress ? postalCode : null,
    city:              hasStructuredAddress ? city       : null,
    // Même raison que dans formatAddressLines : un pays seul n'est pas une adresse.
    country:           hasStructuredAddress ? country    : null,
    address:           formatAddress(input),
  }
}

// Les valeurs de départ d'un formulaire d'adresse, toujours des chaînes (jamais null) pour
// un champ contrôlé. Migration opportuniste : quand la fiche n'a que l'adresse héritée en
// texte libre, elle est placée dans le champ "Adresse" au lieu d'être ignorée — la personne
// qui modifie sa fiche n'a plus qu'à compléter code postal et ville, et l'enregistrement
// repart structuré. Rien n'est réécrit tant que personne n'enregistre le formulaire.
export type AddressFormValues = {
  addressStreet:     string
  addressComplement: string
  postalCode:        string
  city:              string
  country:           string
}

export const EMPTY_ADDRESS_FORM_VALUES: AddressFormValues = {
  addressStreet:     "",
  addressComplement: "",
  postalCode:        "",
  city:              "",
  country:           "",
}

export function addressFormValues(source: {
  addressStreet?:     string | null
  addressComplement?: string | null
  postalCode?:        string | null
  city?:              string | null
  country?:           string | null
  address?:           string | null
} | null | undefined): AddressFormValues {
  if (!source) return { ...EMPTY_ADDRESS_FORM_VALUES }

  const { street, complement, locality } = structuredParts({
    street:     source.addressStreet,
    complement: source.addressComplement,
    postalCode: source.postalCode,
    city:       source.city,
  })
  const hasStructuredAddress = !!(street || complement || locality)

  return {
    addressStreet:     hasStructuredAddress ? (source.addressStreet ?? "") : (source.address ?? ""),
    addressComplement: source.addressComplement ?? "",
    postalCode:        source.postalCode        ?? "",
    city:              source.city              ?? "",
    country:           source.country           ?? "",
  }
}

// Mise à jour partielle (PATCH) : l'adresse se met à jour d'un bloc. Dès qu'un seul de ses
// champs est envoyé, les six colonnes sont recalculées ensemble, à partir de ce qui est
// envoyé complété par ce qui est déjà en base — sans ça, une ville modifiée seule laisserait
// la colonne héritée dire autre chose que les colonnes structurées. Aucun champ d'adresse
// dans la requête → objet vide, la mise à jour ne touche pas à l'adresse.
export type AddressPayload = {
  address?:           string | null
  addressStreet?:     string | null
  addressComplement?: string | null
  postalCode?:        string | null
  city?:              string | null
  country?:           string | null
}

const ADDRESS_PAYLOAD_KEYS = ["address", "addressStreet", "addressComplement", "postalCode", "city", "country"] as const

// Le champ « Adresse » d'une matrice de champs standards (adhésion, don, événement) est
// satisfait de deux façons : par une adresse structurée complète (voie + code postal +
// ville — exactement ce que le formulaire public rend obligatoire), ou par la seule
// adresse héritée en texte libre — un onglet resté ouvert sur l'ancien formulaire ne poste
// que celle-là et ne doit pas se voir refuser. Le complément et le pays ne comptent jamais :
// ils restent facultatifs des deux côtés. Un seul endroit pour cette règle plutôt qu'une
// copie par route : les routes qui la réimplémentaient localement avaient fini par diverger
// (voir l'historique de ce fichier).
export type SubmittedAddress = {
  address?:       string
  addressStreet?: string
  postalCode?:    string
  city?:          string
}

export function addressIsFilled(submitted: SubmittedAddress): boolean {
  const hasStructuredAddress =
    !!submitted.addressStreet?.trim() && !!submitted.postalCode?.trim() && !!submitted.city?.trim()
  return hasStructuredAddress || !!submitted.address?.trim()
}

// Vrai quand `addressFormValues` ci-dessus va déposer l'adresse héritée en texte libre dans
// le champ Rue faute de mieux (« migration opportuniste »). Ce texte peut déjà contenir le
// code postal et la ville — c'était un champ ouvert unique — donc quelqu'un qui complète
// juste les nouveaux champs Code postal/Ville sans relire la Rue risque de les dupliquer
// dans l'adresse enregistrée. Sert uniquement à afficher un avertissement ; ne modifie rien.
export function addressWasMigratedFromLegacy(source: {
  addressStreet?:     string | null
  addressComplement?: string | null
  postalCode?:        string | null
  city?:              string | null
  address?:           string | null
} | null | undefined): boolean {
  if (!source) return false
  const { street, complement, locality } = structuredParts({
    street:     source.addressStreet,
    complement: source.addressComplement,
    postalCode: source.postalCode,
    city:       source.city,
  })
  return !(street || complement || locality) && !!cleanedValue(source.address)
}

export function addressColumnsPatch(payload: AddressPayload, existing: AddressPayload): Partial<AddressColumns> {
  const touchesAddress = ADDRESS_PAYLOAD_KEYS.some(key => payload[key] !== undefined)
  if (!touchesAddress) return {}

  const merged = (key: typeof ADDRESS_PAYLOAD_KEYS[number]) =>
    payload[key] !== undefined ? payload[key] : existing[key]

  return addressColumns({
    street:     merged("addressStreet"),
    complement: merged("addressComplement"),
    postalCode: merged("postalCode"),
    city:       merged("city"),
    country:    merged("country"),
    legacy:     merged("address"),
  })
}
