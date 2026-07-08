const UNITS = ["", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"]

function tens(n: number): string {
  if (n < 17) return UNITS[n]
  if (n < 20) return "dix-" + UNITS[n - 10]
  if (n < 60) {
    const t = Math.floor(n / 10)
    const u = n % 10
    const word = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante" }[t]!
    if (u === 0) return word
    if (u === 1) return word + " et un"
    return word + "-" + UNITS[u]
  }
  if (n < 80) {
    // 60-79: soixante + (0..19)
    if (n === 60) return "soixante"
    if (n === 61) return "soixante et un"
    if (n === 71) return "soixante et onze"
    return "soixante-" + tens(n - 60)
  }
  // 80-99: quatre-vingt(s) + (0..19)
  if (n === 80) return "quatre-vingts"
  if (n < 100) return "quatre-vingt-" + tens(n - 80)
  throw new Error(`tens() called with out-of-range value: ${n}`)
}

function hundreds(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h === 0) return tens(rest)
  const prefix = h === 1 ? "cent" : UNITS[h] + " cent"
  if (rest === 0) return h > 1 ? prefix + "s" : prefix
  return prefix + " " + tens(rest)
}

function belowMillion(n: number): string {
  const thousands = Math.floor(n / 1000)
  const rest = n % 1000
  let result = ""
  if (thousands > 0) {
    result = (thousands === 1 ? "mille" : hundreds(thousands) + " mille")
  }
  if (rest > 0) result += (result ? " " : "") + hundreds(rest)
  return result || "zéro"
}

export function numberToFrenchWords(n: number): string {
  if (n === 0) return "zéro"
  const millions = Math.floor(n / 1_000_000)
  const rest = n % 1_000_000
  let result = ""
  if (millions > 0) {
    result = (millions === 1 ? "un million" : belowMillion(millions) + " millions")
  }
  if (rest > 0) result += (result ? " " : "") + belowMillion(rest)
  return result
}

// "1234,56" -> "mille deux cent trente-quatre euros et cinquante-six centimes"
export function amountToFrenchWords(amount: number): string {
  const euros = Math.floor(amount)
  const centimes = Math.round((amount - euros) * 100)
  let text = `${numberToFrenchWords(euros)} euro${euros > 1 ? "s" : ""}`
  if (centimes > 0) text += ` et ${numberToFrenchWords(centimes)} centime${centimes > 1 ? "s" : ""}`
  return text
}
