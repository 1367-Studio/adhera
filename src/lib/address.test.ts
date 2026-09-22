import { describe, expect, it } from "vitest"
import { EMPTY_ADDRESS_FORM_VALUES, addressColumns, addressColumnsPatch, addressFormValues, formatAddress, formatAddressLines } from "@/lib/address"

describe("formatAddress", () => {
  // Le cas qui compte le plus : tous les membres/dons créés avant le découpage du champ
  // adresse n'ont que ce texte libre, et leur reçu fiscal doit rester identique.
  it("renders a legacy free-text address unchanged", () => {
    expect(formatAddress({ legacy: "12 rue de la Paix, 75002 Paris" })).toBe("12 rue de la Paix, 75002 Paris")
  })

  it("composes the structured fields in French postal order", () => {
    expect(formatAddress({
      street:     "12 rue de la Paix",
      complement: "Bâtiment B",
      postalCode: "75002",
      city:       "Paris",
      country:    "France",
    })).toBe("12 rue de la Paix, Bâtiment B, 75002 Paris, France")
  })

  // Pendant la transition, les deux coexistent sur un même enregistrement (double
  // écriture) : la version structurée est la plus fiable, elle gagne toujours.
  it("prefers the structured fields when both are present", () => {
    expect(formatAddress({ street: "3 allée des Tilleuls", city: "Lyon", legacy: "ancienne adresse" }))
      .toBe("3 allée des Tilleuls, Lyon")
  })

  it("returns null when there is no address at all", () => {
    expect(formatAddress({})).toBeNull()
    expect(formatAddress({ legacy: null })).toBeNull()
  })

  // Reproduit exactement ce que faisaient les PDF avant ce helper :
  // [association.address, association.city].filter(Boolean).join(", ")
  it("joins a street and a city with no postal code, as the PDFs did", () => {
    expect(formatAddress({ street: "8 place du Marché", city: "Nantes" })).toBe("8 place du Marché, Nantes")
  })

  it("omits the locality line when neither postal code nor city is set", () => {
    expect(formatAddress({ street: "8 place du Marché" })).toBe("8 place du Marché")
  })

  it("renders a postal code without a city", () => {
    expect(formatAddress({ street: "8 place du Marché", postalCode: "44000" })).toBe("8 place du Marché, 44000")
  })

  // Une cellule importée ne contenant que des espaces ne doit pas produire une ligne
  // blanche dans un reçu fiscal.
  it("treats blank strings as absent", () => {
    expect(formatAddress({ legacy: "   " })).toBeNull()
    expect(formatAddress({ street: "  4 rue Neuve  ", city: "   " })).toBe("4 rue Neuve")
  })
})

describe("formatAddressLines", () => {
  it("returns one line per address part, for stacked layouts", () => {
    expect(formatAddressLines({ street: "12 rue de la Paix", postalCode: "75002", city: "Paris" }))
      .toEqual(["12 rue de la Paix", "75002 Paris"])
  })

  it("returns the legacy address as a single line", () => {
    expect(formatAddressLines({ legacy: "12 rue de la Paix, 75002 Paris" })).toEqual(["12 rue de la Paix, 75002 Paris"])
  })

  it("returns an empty array rather than a blank line", () => {
    expect(formatAddressLines({})).toEqual([])
  })
})

describe("country alone", () => {
  // Un formulaire qui pré-remplit "France" et que le visiteur laisse vide ne doit pas
  // créer une adresse fantôme sur une fiche qui n'en a pas.
  it("is not an address", () => {
    expect(formatAddress({ country: "France" })).toBeNull()
    expect(addressColumns({ country: "France" }).country).toBeNull()
    expect(addressColumns({ country: "France" }).address).toBeNull()
  })

  it("does not hide a legacy address", () => {
    expect(formatAddress({ country: "France", legacy: "12 rue de la Paix, 75002 Paris" }))
      .toBe("12 rue de la Paix, 75002 Paris")
  })
})

describe("addressColumns", () => {
  it("writes the structured columns and keeps the legacy column in sync", () => {
    expect(addressColumns({ street: "12 rue de la Paix", postalCode: "75002", city: "Paris", country: "France" }))
      .toEqual({
        addressStreet:     "12 rue de la Paix",
        addressComplement: null,
        postalCode:        "75002",
        city:              "Paris",
        country:           "France",
        address:           "12 rue de la Paix, 75002 Paris, France",
      })
  })

  // Un onglet resté ouvert sur l'ancien formulaire ne poste que le texte libre : il doit
  // continuer à enregistrer une adresse valide plutôt que d'en perdre une.
  it("still accepts a legacy-only payload", () => {
    expect(addressColumns({ legacy: "12 rue de la Paix, 75002 Paris" })).toEqual({
      addressStreet:     null,
      addressComplement: null,
      postalCode:        null,
      city:              null,
      country:           null,
      address:           "12 rue de la Paix, 75002 Paris",
    })
  })

  it("clears every column when the form is empty", () => {
    expect(addressColumns({})).toEqual({
      addressStreet: null, addressComplement: null, postalCode: null, city: null, country: null, address: null,
    })
  })
})

describe("addressFormValues", () => {
  it("puts a legacy address into the street field so a normal edit migrates the record", () => {
    expect(addressFormValues({ address: "12 rue de la Paix, 75002 Paris" })).toEqual({
      addressStreet: "12 rue de la Paix, 75002 Paris", addressComplement: "", postalCode: "", city: "", country: "",
    })
  })

  it("uses the structured columns when they exist and ignores the legacy copy", () => {
    expect(addressFormValues({
      addressStreet: "12 rue de la Paix", postalCode: "75002", city: "Paris", country: "France",
      address: "12 rue de la Paix, 75002 Paris, France",
    })).toEqual({
      addressStreet: "12 rue de la Paix", addressComplement: "", postalCode: "75002", city: "Paris", country: "France",
    })
  })

  it("returns empty strings for a record with no address and for no record at all", () => {
    expect(addressFormValues({})).toEqual(EMPTY_ADDRESS_FORM_VALUES)
    expect(addressFormValues(null)).toEqual(EMPTY_ADDRESS_FORM_VALUES)
  })
})

describe("addressColumnsPatch", () => {
  const existing = {
    address: "12 rue de la Paix, 75002 Paris", addressStreet: "12 rue de la Paix",
    addressComplement: null, postalCode: "75002", city: "Paris", country: "France",
  }

  it("leaves the address alone when the request does not mention it", () => {
    expect(addressColumnsPatch({ }, existing)).toEqual({})
  })

  // Le cas qui justifie la fusion : une ville modifiée seule doit aussi mettre à jour la
  // colonne héritée, sinon les deux se contredisent.
  it("recomputes every column from one changed field", () => {
    expect(addressColumnsPatch({ city: "Lyon" }, existing)).toEqual({
      addressStreet: "12 rue de la Paix", addressComplement: null, postalCode: "75002",
      city: "Lyon", country: "France", address: "12 rue de la Paix, 75002 Lyon, France",
    })
  })

  it("clears the whole address when the form is submitted empty", () => {
    expect(addressColumnsPatch(
      { address: "", addressStreet: "", addressComplement: "", postalCode: "", city: "", country: "" },
      existing,
    )).toEqual({
      addressStreet: null, addressComplement: null, postalCode: null, city: null, country: null, address: null,
    })
  })

  // Une fiche encore en texte libre que l'on complète : les colonnes structurées prennent
  // la main et la colonne héritée est recomposée à partir d'elles.
  it("migrates a legacy record that gets structured fields", () => {
    expect(addressColumnsPatch(
      { addressStreet: "12 rue de la Paix", postalCode: "75002", city: "Paris" },
      { address: "12 rue de la paix 75002 paris" },
    )).toEqual({
      addressStreet: "12 rue de la Paix", addressComplement: null, postalCode: "75002",
      city: "Paris", country: null, address: "12 rue de la Paix, 75002 Paris",
    })
  })
})
