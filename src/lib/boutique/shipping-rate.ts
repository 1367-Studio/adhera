// Real-time shipping quotes for Boutique home delivery — resells actual carrier tariffs
// (Colissimo, Mondial Relay, etc.) through a single platform-wide Sendcloud account. There
// is no per-association Sendcloud account: an association only configures its own shipping
// origin address (Association.shipping*), which is passed as `from_address` on every quote
// call below — Sendcloud's own "Sender Addresses" concept (label printing) is unrelated and
// unused here, this module only ever calls the price-quote endpoint, never label creation.
const SENDCLOUD_API_URL = "https://panel.sendcloud.sc/api/v3/shipping-options"

export type ShippingOption = {
  code: string
  carrierLabel: string
  costCents: number
  leadTimeHours: number | null
}

type ShippingQuoteInput = {
  originCountry: string
  originPostalCode: string
  destCountry: string
  destPostalCode: string
  weightGrams: number
}

type SendcloudPrice = { value: string; currency: string }
type SendcloudQuote = { lead_time: number | null; price: { total: SendcloudPrice } }
type SendcloudOption = {
  code: string
  name: string
  carrier?: { name: string }
  quotes?: SendcloudQuote[]
  quote_error?: unknown
}

// Keyed by the exact route+weight combo — short TTL only to absorb a buyer retyping the
// same postal code a few times while filling the cart form, not meant to serve stale prices.
const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, { options: ShippingOption[]; expires: number }>()

export async function getShippingRates(input: ShippingQuoteInput): Promise<ShippingOption[]> {
  const publicKey  = process.env.SENDCLOUD_PUBLIC_KEY
  const privateKey = process.env.SENDCLOUD_PRIVATE_KEY
  if (!publicKey || !privateKey) return []

  const { originCountry, originPostalCode, destCountry, destPostalCode, weightGrams } = input
  if (!originCountry || !originPostalCode || !destCountry || !destPostalCode || weightGrams <= 0) return []

  const cacheKey = `${originCountry}|${originPostalCode}|${destCountry}|${destPostalCode}|${weightGrams}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.options

  let options: ShippingOption[] = []
  try {
    const res = await fetch(SENDCLOUD_API_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${Buffer.from(`${publicKey}:${privateKey}`).toString("base64")}`,
      },
      body: JSON.stringify({
        from_address:      { country_code: originCountry, postal_code: originPostalCode },
        to_address:        { country_code: destCountry, postal_code: destPostalCode },
        parcels:           [{ weight: { value: (weightGrams / 1000).toFixed(3), unit: "kg" } }],
        calculate_quotes:  true,
      }),
    })

    if (res.ok) {
      const body = (await res.json()) as { data?: SendcloudOption[] }
      options = (body.data ?? [])
        .filter((o): o is SendcloudOption & { quotes: SendcloudQuote[] } => !o.quote_error && !!o.quotes?.length)
        .map(o => {
          const quote = o.quotes[0]
          return {
            code:          o.code,
            carrierLabel:  o.name || o.carrier?.name || "Livraison",
            costCents:     Math.round(parseFloat(quote.price.total.value) * 100),
            leadTimeHours: quote.lead_time ?? null,
          }
        })
        .sort((a, b) => a.costCents - b.costCents)
    } else {
      console.error(`[boutique-shipping-rate] Sendcloud returned ${res.status} for ${cacheKey}`)
    }
  } catch (err) {
    console.error(`[boutique-shipping-rate] Sendcloud call failed for ${cacheKey}:`, err)
  }

  cache.set(cacheKey, { options, expires: Date.now() + CACHE_TTL_MS })
  return options
}
