import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { APP_TIME_ZONE } from "@/lib/date-format"

export interface DocumentPdfItem {
  description: string
  quantity:    number
  unitPrice:   number
  vatRate:     number
  discount:    number
}

export interface DocumentPdfInput {
  kind:           "DEVIS" | "FACTURE" | "BOUTIQUE" | "MATERIEL_LOAN"
  number:         string
  issueDate:      Date
  secondaryLabel: string
  secondaryDate:  Date | null
  association: {
    name:    string
    address: string | null
    city:    string | null
    siren:   string | null
    website: string | null
    // Only ever printed on DEVIS/FACTURE (see buildDocumentPdf) — a BOUTIQUE receipt is
    // always for an already-settled sale, so a RIB has nothing useful to tell the buyer.
    iban: string | null
    bic:  string | null
    // Resolved by resolveDocumentBranding() — already null when the association's plan
    // doesn't include custom branding, so this file doesn't need to know about plans.
    logoUrl: string | null
  }
  fournisseur: {
    companyName: string
    address:     string | null
    city:        string | null
    postalCode:  string | null
    siret:       string | null
    vatNumber:   string | null
  } | null
  items:          DocumentPdfItem[]
  subtotal:       number
  vatAmount:      number
  discountAmount: number
  total:          number
  amountPaid?:    number
  notes:          string | null
  paymentTerms:   string | null
  // Only ever printed on FACTURE (see buildDocumentPdf) — a DEVIS/BOUTIQUE/MATERIEL_LOAN
  // document has no "how will you pay" expectation to communicate.
  paymentMethod?: string | null
}

const BLACK = "#1a1a1a"
const GRAY  = "#737373"
const ACCENT = GRAY
// Separate from ACCENT (used for labels/headings) — the rule lines read too heavy at full
// text contrast, so they get their own lighter gray.
const RULE_COLOR = "#bfbfbf"
// Formwise's own brand blue (--primary in globals.css) — used once, deliberately, on the
// final "Restant dû" rule. Everything else stays black/gray: per the design system, the
// brand color marks the one thing that matters most, not every heading on the page.
const BRAND_BLUE = "#023d9d"

// Item table column widths, in points, summing to the full content width (495.28 = page
// width 595.28 minus the 50pt margin on each side) so the header/body/right edge all align
// without any manual x-coordinate bookkeeping.
const COL_QTY = 40
const COL_PRICE = 70
const COL_VAT = 55
const COL_DISCOUNT = 65
const COL_TOTAL = 70
const COL_DESC = 495.28 - (COL_QTY + COL_PRICE + COL_VAT + COL_DISCOUNT + COL_TOTAL)

// toLocaleString("fr-FR") inserts a narrow no-break space between thousands that the
// standard Helvetica (WinAnsi) encoding can't render — same issue already worked around
// in recu-fiscal.ts. Format manually with a plain space instead.
function fmtEUR(n: number): string {
  const sign = n < 0 ? "-" : ""
  const [intPart, decPart] = Math.abs(n).toFixed(2).split(".")
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${sign}${withThousands},${decPart} €`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { timeZone: APP_TIME_ZONE })
}

// The "Adresse" field is free text, so it sometimes already ends with the city (typed
// that way, or picked from an autocomplete) while "Ville" is also filled in separately —
// without this, the two get concatenated and the city shows up twice on the document.
function stripTrailingCity(address: string | null, city: string | null): string | null {
  if (!address || !city) return address
  const trimmedAddress = address.trim()
  const trimmedCity    = city.trim()
  if (trimmedAddress.toLowerCase().endsWith(trimmedCity.toLowerCase())) {
    const withoutCity = trimmedAddress.slice(0, trimmedAddress.length - trimmedCity.length).replace(/[,\s]+$/, "")
    return withoutCity || null
  }
  return address
}

const styles = StyleSheet.create({
  page: { padding: 50, fontFamily: "Helvetica", fontSize: 10, color: BLACK },

  masthead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  // gap doesn't go negative (Yoga clamps it at 0) — marginRight on the logo itself is what
  // actually pulls the text in closer than a plain gap of 0 would.
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 0 },
  // `maxWidth`/`maxHeight` alone stretch the image to fill both, ignoring its own aspect
  // ratio — a fixed box + objectFit:"contain" scales it down without distorting it instead.
  logo: { width: 60, height: 25, objectFit: "contain", marginLeft: -15, marginRight: -8 },
  nameText: { fontFamily: "Helvetica-Bold", fontSize: 17, maxWidth: 300 },
  titleBlock: { alignItems: "flex-end" },
  titleText: { fontFamily: "Helvetica-Bold", fontSize: 22 },
  titleNumber: { fontSize: 11, color: GRAY, marginTop: 6 },
  ruleAccent: { borderBottomWidth: 1, borderBottomColor: RULE_COLOR, marginTop: 10, marginBottom: 20 },

  partiesRow: {
    flexDirection: "row", justifyContent: "space-between", gap: 24,
    paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: RULE_COLOR,
  },
  col: { flex: 1 },
  colHeading: { fontFamily: "Helvetica-Bold", fontSize: 9, color: ACCENT, marginBottom: 6 },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 3 },
  muted: { fontSize: 9, color: BLACK, marginBottom: 3, lineHeight: 1.3 },

  // Label stacked above value — not "Label : value" inline — with the blocks spread
  // space-between across the full width: each sized to its own content, equal gaps,
  // first block flush left and last flush right (real flexbox, not manual x offsets).
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16, marginBottom: 20 },
  metaLabel: { fontSize: 9, color: GRAY, marginBottom: 5 },
  metaValue: { fontFamily: "Helvetica-Bold", fontSize: 13 },

  tableHeaderRow: { flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: RULE_COLOR },
  tableRow: { flexDirection: "row", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: RULE_COLOR },
  th: { fontFamily: "Helvetica-Bold", fontSize: 9, color: ACCENT },
  td: { fontSize: 9 },
  colDesc:     { width: COL_DESC, paddingRight: 8 },
  colQty:      { width: COL_QTY, textAlign: "right" },
  colPrice:    { width: COL_PRICE, textAlign: "right" },
  colVat:      { width: COL_VAT, textAlign: "right" },
  colDiscount: { width: COL_DISCOUNT, textAlign: "right" },
  colTotal:    { width: COL_TOTAL, textAlign: "right" },

  totalsWrap: { alignItems: "flex-end", marginTop: 20 },
  totalsBlock: { width: 260 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  totalsLabelMuted: { fontSize: 10, color: GRAY },
  totalsValueMuted: { fontSize: 10, color: GRAY },
  totalsValue: { fontSize: 10 },
  ruleBeforeTotal: { borderBottomWidth: 1, borderBottomColor: RULE_COLOR, marginBottom: 9 },
  totalTTCLabel: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  totalTTCValue: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  blueRule: { borderBottomWidth: 1, borderBottomColor: BRAND_BLUE, marginVertical: 8 },
  dueLabel: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  dueValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },

  footerRow: {
    flexDirection: "row", justifyContent: "space-between", gap: 24,
    marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: RULE_COLOR,
  },
  footerHeading: { fontFamily: "Helvetica-Bold", fontSize: 9, color: GRAY, marginBottom: 6 },
  footerText: { fontSize: 9, lineHeight: 1.4 },
  notesSection: { marginTop: 16 },
  notesHeading: { fontFamily: "Helvetica-Bold", fontSize: 9, color: GRAY, marginBottom: 6 },
  notesText: { fontSize: 9, lineHeight: 1.4 },

  pageNumber: { position: "absolute", bottom: 24, right: 50, fontSize: 9, color: GRAY },
})

interface PartyLine { value: string; bold?: boolean }

function PartyColumn({ heading, lines }: { heading: string; lines: PartyLine[] }) {
  return (
    <View style={styles.col}>
      <Text style={styles.colHeading}>{heading}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={line.bold ? styles.partyName : styles.muted}>{line.value}</Text>
      ))}
    </View>
  )
}

function InvoiceDocument({ input, logoSrc }: { input: DocumentPdfInput; logoSrc: { data: Buffer; format: "png" | "jpg" } | null }) {
  const title = input.kind === "DEVIS" ? "DEVIS"
    : input.kind === "FACTURE"       ? "FACTURE"
    : input.kind === "MATERIEL_LOAN" ? "BON DE PRÊT"
    : "REÇU"

  const associationAddress = stripTrailingCity(input.association.address, input.association.city)
  const emetteurLines: PartyLine[] = [{ value: input.association.name, bold: true }]
  const emetteurAddrLine = [associationAddress, input.association.city].filter(Boolean).join(", ")
  if (emetteurAddrLine)          emetteurLines.push({ value: emetteurAddrLine })
  if (input.association.siren)   emetteurLines.push({ value: `SIREN : ${input.association.siren}` })
  if (input.association.website) emetteurLines.push({ value: input.association.website })

  const destinataireLines: PartyLine[] = []
  if (input.fournisseur) {
    destinataireLines.push({ value: input.fournisseur.companyName, bold: true })
    const fournisseurAddress = stripTrailingCity(input.fournisseur.address, input.fournisseur.city)
    const destAddrLine = [fournisseurAddress, [input.fournisseur.postalCode, input.fournisseur.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    if (destAddrLine)                destinataireLines.push({ value: destAddrLine })
    if (input.fournisseur.siret)     destinataireLines.push({ value: `SIRET : ${input.fournisseur.siret}` })
    if (input.fournisseur.vatNumber) destinataireLines.push({ value: `N° TVA : ${input.fournisseur.vatNumber}` })
  } else {
    destinataireLines.push({ value: "Client ponctuel" })
  }

  const metaBlocks: Array<{ label: string; value: string }> = [
    { label: "Date d'émission", value: fmtDate(input.issueDate) },
  ]
  if (input.secondaryDate) metaBlocks.push({ label: input.secondaryLabel, value: fmtDate(input.secondaryDate) })
  if (input.paymentMethod) metaBlocks.push({ label: "Mode de paiement", value: input.paymentMethod })

  // A single shared rate prints as "TVA (20 %)" like the rest of the document's VAT labels —
  // mixed rates across items have no one percentage to show, so the label stays generic.
  const vatRates = new Set(input.items.map(i => i.vatRate))
  const vatLabel = vatRates.size === 1 ? `TVA (${[...vatRates][0]} %)` : "TVA"

  // Bank details are FACTURE only: a BOUTIQUE receipt is for an already-settled sale
  // (nothing left to pay), and a DEVIS is just an estimate the client hasn't accepted yet —
  // printing a RIB on it reads as asking for payment before there's anything to actually pay.
  const showBank  = input.kind === "FACTURE" && !!(input.association.iban || input.association.bic)
  const showTerms = !!input.paymentTerms

  return (
    <Document>
      <Page size={[595.28, 841.89]} style={styles.page}>
        <View style={styles.masthead}>
          {logoSrc ? (
            <View style={styles.brandLockup}>
              {/* react-pdf's Image is a PDF drawing primitive, not an HTML <img> — it has
                  no `alt` prop to give (jsx-a11y's web-accessibility rule doesn't apply here). */}
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image src={logoSrc} style={styles.logo} />
              <Text style={styles.nameText}>{input.association.name}</Text>
            </View>
          ) : (
            <Text style={styles.nameText}>{input.association.name}</Text>
          )}
          <View style={styles.titleBlock}>
            <Text style={styles.titleText}>{title}</Text>
            <Text style={styles.titleNumber}>N° {input.number}</Text>
          </View>
        </View>
        <View style={styles.ruleAccent} />

        <View style={styles.partiesRow}>
          <PartyColumn heading="Émetteur" lines={emetteurLines} />
          <PartyColumn heading="Facturé à" lines={destinataireLines} />
        </View>

        <View style={styles.metaRow}>
          {metaBlocks.map((block) => (
            <View key={block.label}>
              <Text style={styles.metaLabel}>{block.label}</Text>
              <Text style={styles.metaValue}>{block.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.tableHeaderRow}>
          <Text style={[styles.th, styles.colDesc]}>Description</Text>
          <Text style={[styles.th, styles.colQty]}>Qté</Text>
          <Text style={[styles.th, styles.colPrice]}>Prix U.</Text>
          <Text style={[styles.th, styles.colVat]}>TVA %</Text>
          <Text style={[styles.th, styles.colDiscount]}>Remise</Text>
          <Text style={[styles.th, styles.colTotal]}>Total</Text>
        </View>
        {input.items.map((item, i) => {
          const lineTotal = item.quantity * item.unitPrice - item.discount
          return (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, styles.colDesc]}>{item.description}</Text>
              <Text style={[styles.td, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.td, styles.colPrice]}>{fmtEUR(item.unitPrice)}</Text>
              <Text style={[styles.td, styles.colVat]}>{item.vatRate}%</Text>
              <Text style={[styles.td, styles.colDiscount]}>{item.discount > 0 ? `- ${fmtEUR(item.discount)}` : "—"}</Text>
              <Text style={[styles.td, styles.colTotal]}>{fmtEUR(lineTotal)}</Text>
            </View>
          )
        })}

        <View style={styles.totalsWrap} wrap={false}>
          <View style={styles.totalsBlock}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabelMuted}>Total HT</Text>
              <Text style={styles.totalsValueMuted}>{fmtEUR(input.subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabelMuted}>{vatLabel}</Text>
              <Text style={styles.totalsValueMuted}>{fmtEUR(input.vatAmount)}</Text>
            </View>
            {input.discountAmount > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabelMuted}>Remise totale</Text>
                <Text style={styles.totalsValueMuted}>- {fmtEUR(input.discountAmount)}</Text>
              </View>
            )}
            <View style={styles.ruleBeforeTotal} />
            <View style={[styles.totalsRow, { marginBottom: input.amountPaid !== undefined ? 9 : 0 }]}>
              <Text style={styles.totalTTCLabel}>Total TTC</Text>
              <Text style={styles.totalTTCValue}>{fmtEUR(input.total)}</Text>
            </View>
            {input.amountPaid !== undefined && (
              <>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabelMuted}>Montant payé</Text>
                  <Text style={styles.totalsValueMuted}>{fmtEUR(input.amountPaid)}</Text>
                </View>
                <View style={styles.blueRule} />
                <View style={styles.totalsRow}>
                  <Text style={styles.dueLabel}>Restant dû</Text>
                  <Text style={styles.dueValue}>{fmtEUR(input.total - input.amountPaid)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {(showBank || showTerms) && (
          <View style={styles.footerRow} wrap={false}>
            {showBank && (
              <View style={styles.col}>
                <Text style={styles.footerHeading}>Coordonnées bancaires</Text>
                {input.association.iban && <Text style={styles.footerText}>IBAN : {input.association.iban}</Text>}
                {input.association.bic && <Text style={styles.footerText}>BIC : {input.association.bic}</Text>}
              </View>
            )}
            {showTerms && (
              <View style={styles.col}>
                <Text style={styles.footerHeading}>Conditions de paiement</Text>
                <Text style={styles.footerText}>{input.paymentTerms}</Text>
              </View>
            )}
          </View>
        )}

        {input.notes && (
          <View style={styles.notesSection} wrap={false}>
            <Text style={styles.notesHeading}>Notes</Text>
            <Text style={styles.notesText}>{input.notes}</Text>
          </View>
        )}

        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`}
        />
      </Page>
    </Document>
  )
}

export async function buildDocumentPdf(input: DocumentPdfInput): Promise<Buffer> {
  let logoSrc: { data: Buffer; format: "png" | "jpg" } | null = null
  if (input.association.logoUrl) {
    try {
      const res = await fetch(input.association.logoUrl)
      const bytes = Buffer.from(await res.arrayBuffer())
      const contentType = res.headers.get("content-type") ?? ""
      logoSrc = { data: bytes, format: contentType.includes("png") ? "png" : "jpg" }
    } catch {
      logoSrc = null // logo optional — never fail a devis/facture over a broken image
    }
  }

  return renderToBuffer(<InvoiceDocument input={input} logoSrc={logoSrc} />)
}
