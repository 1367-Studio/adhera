/**
 * Generates a `src/messages/<locale>.json` catalogue from the French source, via Azure
 * Translator — the same service (and the same credentials) the runtime already uses to
 * translate association-authored content in src/lib/i18n/translate.ts.
 *
 *   npx tsx scripts/generate-locale.ts bg cs da       # named locales
 *   npx tsx scripts/generate-locale.ts --all          # every EU locale missing a catalogue
 *   npx tsx scripts/generate-locale.ts bg --dry-run   # count the work, call nothing
 *   npx tsx scripts/generate-locale.ts bg --force     # retranslate keys that already exist
 *
 * Incremental by default: a locale that already has a catalogue only gets its MISSING keys
 * translated, so adding one French string later costs one string, not 3 873. Key order
 * follows the French file, so the diff of a regenerated catalogue stays readable.
 *
 * Machine output is a starting point, not a finished translation — see the plural note on
 * decomposeIcu below, and expect a native speaker to review anything user-facing.
 */
import fs from "fs"
import path from "path"
import * as dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const MESSAGES_DIR = path.join(process.cwd(), "src", "messages")
const SOURCE_FILE = path.join(MESSAGES_DIR, "fr.json")

// Azure caps a request at 1 000 strings / 50 000 characters. 400 keeps us clear of both
// even when the catalogue grows long strings (the FAQ answers run past 300 characters).
const BATCH_SIZE = 400

const AZURE_ENDPOINT =
  "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=html"

// The 24 official languages of the EU, keyed by the BCP-47 tag both the browser's
// accept-language header and Azure Translator use. `fr` is the source, so it is not a
// target. `pt` is Brazilian Portuguese and `pt-PT` European — the app carries both.
const EU_TARGETS = [
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "ga", "hr", "hu",
  "it", "lt", "lv", "mt", "nl", "pl", "pt", "pt-PT", "ro", "sk", "sl", "sv",
] as const

// Azure's own tag where it differs from BCP-47. Only European Portuguese needs the mapping;
// every other EU language uses the same tag on both sides.
const AZURE_TAG: Record<string, string> = { "pt-PT": "pt-pt" }

type Node = string | number | boolean | null | Node[] | { [k: string]: Node }

// ─── ICU ──────────────────────────────────────────────────────────────────────

type Piece =
  | { kind: "verbatim"; value: string } // ICU syntax and placeholders — never sent anywhere
  | { kind: "text"; value: string } //     natural language — the only thing translated

/**
 * Splits an ICU message into what may be translated and what must survive byte-for-byte.
 *
 * A placeholder (`{name}`) is passed through whole. A plural block is taken apart so only
 * the prose inside each branch travels to Azure — sending `{count, plural, one {...}}` as
 * one string invites the translator to "translate" the keywords `plural`/`one`/`other` and
 * hand back a message ICU can no longer parse.
 *
 * Known limitation: the branches a message declares are kept as-is. The catalogue only ever
 * uses `one`/`other` (verified across all 3 873 strings), which is right for French and for
 * the Germanic and Romance targets, but Czech, Polish, Croatian, Lithuanian, Slovenian,
 * Romanian, Irish and Maltese distinguish more categories. ICU falls back to `other` for the
 * missing ones, so nothing breaks — the counted noun is simply in the wrong form for some
 * numbers. Those 91 strings are the ones most worth a native speaker's eyes.
 */
export function decomposeIcu(message: string): Piece[] {
  const pieces: Piece[] = []
  let buffer = ""

  const flush = () => {
    if (buffer) pieces.push({ kind: "text", value: buffer })
    buffer = ""
  }

  for (let i = 0; i < message.length; i++) {
    if (message[i] !== "{") {
      buffer += message[i]
      continue
    }

    // Balanced scan: a plural branch nests braces, so counting is the only way to find the end.
    let depth = 0
    let end = i
    for (; end < message.length; end++) {
      if (message[end] === "{") depth++
      else if (message[end] === "}" && --depth === 0) break
    }
    if (depth !== 0) {
      // Unbalanced — not something we can reason about; treat the rest as opaque.
      buffer += message.slice(i)
      break
    }

    const whole = message.slice(i, end + 1)
    const inner = whole.slice(1, -1)
    const complex = /^\s*[\w.]+\s*,\s*(plural|selectordinal|select)\s*,/.exec(inner)

    flush()
    if (!complex) {
      pieces.push({ kind: "verbatim", value: whole }) // simple placeholder
    } else {
      const headEnd = complex[0].length
      pieces.push({ kind: "verbatim", value: "{" + inner.slice(0, headEnd) })
      pieces.push(...decomposeBranches(inner.slice(headEnd)))
      pieces.push({ kind: "verbatim", value: "}" })
    }
    i = end
  }

  flush()
  return pieces
}

// The `key {submessage}` list inside a plural/select. Keys and braces are syntax; each
// submessage is itself a full ICU message and goes back through decomposeIcu.
function decomposeBranches(body: string): Piece[] {
  const pieces: Piece[] = []
  let i = 0

  while (i < body.length) {
    const open = body.indexOf("{", i)
    if (open === -1) {
      pieces.push({ kind: "verbatim", value: body.slice(i) })
      break
    }

    pieces.push({ kind: "verbatim", value: body.slice(i, open + 1) }) // " one {"

    let depth = 0
    let end = open
    for (; end < body.length; end++) {
      if (body[end] === "{") depth++
      else if (body[end] === "}" && --depth === 0) break
    }

    pieces.push(...decomposeIcu(body.slice(open + 1, end)))
    pieces.push({ kind: "verbatim", value: "}" })
    i = end + 1
  }

  return pieces
}

// Worth a round trip only if there is a letter in there — "2026", "—" and "%" are returned
// unchanged by any translator and would just burn quota.
export const isTranslatable = (text: string) => /\p{L}/u.test(text)

// Azure honours class="notranslate" in HTML mode. `#` is the ICU "the number goes here"
// token inside a plural branch: it is not a word, and letting the translator move or drop it
// silently breaks the message.
export const protectHash = (text: string) =>
  text.replace(/#/g, '<span class="notranslate">#</span>')
export const unprotect = (text: string) =>
  text.replace(/<span class="notranslate">(.*?)<\/span>/g, "$1")

// ─── Azure ────────────────────────────────────────────────────────────────────

async function azureTranslate(texts: string[], target: string): Promise<string[]> {
  const key = process.env.AZURE_TRANSLATOR_KEY
  const region = process.env.AZURE_TRANSLATOR_REGION
  if (!key || !region) {
    throw new Error(
      "AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION missing from .env.local — " +
        "create an Azure Translator resource and add both before running this.",
    )
  }

  const out: string[] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const res = await fetch(`${AZURE_ENDPOINT}&to=${target}`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Ocp-Apim-Subscription-Region": region,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch.map((text) => ({ text }))),
    })
    if (!res.ok) throw new Error(`Azure ${res.status}: ${await res.text()}`)

    const data = (await res.json()) as { translations: { text: string }[] }[]
    out.push(...data.map((d) => d.translations[0].text))
    process.stdout.write(`    ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}\r`)
  }
  return out
}

// ─── Catalogue walk ───────────────────────────────────────────────────────────

// Collects every string in the source that the target still needs, as ICU pieces, so the
// caller can translate the union in one batch rather than one call per string.
function collect(source: Node, existing: Node | undefined, force: boolean, out: Set<string>): void {
  if (typeof source === "string") {
    if (!force && typeof existing === "string") return
    for (const piece of decomposeIcu(source)) {
      if (piece.kind === "text" && isTranslatable(piece.value)) out.add(piece.value)
    }
    return
  }
  if (Array.isArray(source)) {
    source.forEach((item, i) =>
      collect(item, Array.isArray(existing) ? existing[i] : undefined, force, out),
    )
    return
  }
  if (source && typeof source === "object") {
    const prev = existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, Node>)
      : undefined
    for (const [k, v] of Object.entries(source)) collect(v, prev?.[k], force, out)
  }
}

// Rebuilds the catalogue in the source's shape and key order, reusing whatever the target
// already had so an incremental run never disturbs reviewed translations.
function build(source: Node, existing: Node | undefined, force: boolean, map: Map<string, string>): Node {
  if (typeof source === "string") {
    if (!force && typeof existing === "string") return existing
    return decomposeIcu(source)
      .map((piece) =>
        piece.kind === "verbatim" || !isTranslatable(piece.value)
          ? piece.value
          : map.get(piece.value) ?? piece.value,
      )
      .join("")
  }
  if (Array.isArray(source)) {
    return source.map((item, i) =>
      build(item, Array.isArray(existing) ? existing[i] : undefined, force, map),
    )
  }
  if (source && typeof source === "object") {
    const prev = existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, Node>)
      : undefined
    const result: Record<string, Node> = {}
    for (const [k, v] of Object.entries(source)) result[k] = build(v, prev?.[k], force, map)
    return result
  }
  return source
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function generate(locale: string, dryRun: boolean, force: boolean): Promise<void> {
  const source = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf-8")) as Node
  const targetPath = path.join(MESSAGES_DIR, `${locale}.json`)
  const existing = fs.existsSync(targetPath)
    ? (JSON.parse(fs.readFileSync(targetPath, "utf-8")) as Node)
    : undefined

  const needed = new Set<string>()
  collect(source, existing, force, needed)

  const label = existing ? "update" : "create"
  if (needed.size === 0) {
    console.log(`  ${locale}: already complete, nothing to do`)
    return
  }
  console.log(`  ${locale}: ${label}, ${needed.size} segments to translate`)
  if (dryRun) return

  const texts = [...needed]
  const translated = await azureTranslate(
    texts.map(protectHash),
    AZURE_TAG[locale] ?? locale,
  )
  const map = new Map(texts.map((t, i) => [t, unprotect(translated[i])]))

  fs.writeFileSync(targetPath, JSON.stringify(build(source, existing, force, map), null, 2) + "\n", "utf-8")
  console.log(`  ${locale}: wrote ${path.relative(process.cwd(), targetPath)}`)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const force = args.includes("--force")
  const all = args.includes("--all")
  const named = args.filter((a) => !a.startsWith("--"))

  const targets = all
    ? EU_TARGETS.filter((l) => force || !fs.existsSync(path.join(MESSAGES_DIR, `${l}.json`)))
    : named

  if (targets.length === 0) {
    console.error("Usage: npx tsx scripts/generate-locale.ts <locale...> | --all [--dry-run] [--force]")
    console.error(`Known EU targets: ${EU_TARGETS.join(" ")}`)
    process.exit(1)
  }

  const unknown = targets.filter((t) => !(EU_TARGETS as readonly string[]).includes(t))
  if (unknown.length) {
    console.error(`Unknown locale(s): ${unknown.join(", ")}`)
    process.exit(1)
  }

  console.log(`${dryRun ? "[dry run] " : ""}Source: fr.json → ${targets.join(", ")}\n`)
  for (const locale of targets) await generate(locale, dryRun, force)
  console.log("\nDone. Add the new locales to SUPPORTED_LOCALES in src/i18n/locales.ts to enable them.")
}

// Guarded so the ICU helpers above can be imported by a test without kicking off a run.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
