"use client"

import { useTranslations } from "next-intl"
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";

// Adhera runs embedded under formwise.fr/app — these legal pages live on the parent
// formwise-app site itself (single platform-wide set, not per-association), so we link
// out instead of duplicating the content here.
const LEGAL_LINKS = [
  { key: "mentionsLegales",             href: "https://www.formwise.fr/mentions-legales" },
  { key: "cgu",                         href: "https://www.formwise.fr/cgu" },
  { key: "cgs",                         href: "https://www.formwise.fr/cgs" },
  { key: "politiqueConfidentialite",    href: "https://www.formwise.fr/politique-de-confidentialite" },
] as const

export function LegalDocumentsSettings() {
  const t = useTranslations("parametres.legalDocumentsSettings")

  return (
    <div>
      <h3 className="text-sm font-medium">{t("title")}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">
        {t("description")}
      </p>

      <ul className="mt-4 divide-y">
        {LEGAL_LINKS.map(link => (
          // Padding sits on the <li>: each <a> is both first and last child of its own
          // <li>, so first:/last: variants on the anchor would strip every row's padding.
          <li key={link.key} className="py-2.5 first:pt-0 last:pb-0">
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
            >
              {t(link.key)}
              <ArrowSquareOutIcon className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="sr-only">{t("opensNewTab")}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
