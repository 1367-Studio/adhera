// Binary units on purpose (1 Mo = 1024 × 1024 octets): upload caps are enforced server-side
// in binary bytes (MAX_FUNCTION_UPLOAD_BYTES = 4 × 1024 × 1024, src/lib/upload-limits.ts), so a
// "4 Mo" limit shown here has to mean exactly that — with decimal units, a selection sitting
// right at the cap would read "4,2 Mo" against a "4 Mo" limit.
const BYTES_PER_KILOBYTE = 1024
const BYTES_PER_MEGABYTE = 1024 * 1024

// Localized short units through Intl ("3,2 Mo" / "240 ko" in French, "3.2 MB" / "240 kB" in
// English) rather than a hand-built string, so every locale gets its own unit abbreviation,
// decimal separator and spacing.
export function formatFileSize(bytes: number, locale: string): string {
  // A non-empty file never reads "0 ko" — only a genuinely empty amount (e.g. no space left) does.
  const kilobytes = bytes > 0 ? Math.max(1, Math.round(bytes / BYTES_PER_KILOBYTE)) : 0

  // Compared after rounding, so a size just under 1 Mo reads "1 Mo" rather than "1 024 ko".
  if (kilobytes < BYTES_PER_KILOBYTE) {
    return new Intl.NumberFormat(locale, {
      style:                 "unit",
      unit:                  "kilobyte",
      unitDisplay:           "short",
      maximumFractionDigits: 0,
    }).format(kilobytes)
  }

  return new Intl.NumberFormat(locale, {
    style:                 "unit",
    unit:                  "megabyte",
    unitDisplay:           "short",
    maximumFractionDigits: 1,
  }).format(bytes / BYTES_PER_MEGABYTE)
}
