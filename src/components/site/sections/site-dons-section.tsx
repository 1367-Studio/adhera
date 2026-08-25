import Link from "next/link"
import type { DonsSection } from "@/types/site-config"
import { HandshakeIcon, ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr";

type Props = {
  section: DonsSection
  slug:    string
  color:   string
  // Ne promet le reçu fiscal que si l'association est réellement habilitée à en émettre
  // (Paramètres → Identité). Le mentionner à tort serait un engagement fiscal faux.
  canIssueTaxReceipts: boolean
}

export function SiteDonsSection({ section, slug, color, canIssueTaxReceipts }: Props) {
  return (
    <section className="py-16 px-4">
      <div className="max-w-md mx-auto text-center">
        <HandshakeIcon className="size-10 mx-auto mb-4" style={{ color }} />

        <h2 className="text-2xl font-bold mb-2 text-gray-900">{section.title || "Faire un don"}</h2>
        {section.body && <p className="text-gray-500 text-sm mb-8">{section.body}</p>}

        <Link
          href={`/portal/${slug}/don`}
          className="inline-block w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: color }}
        >
          Faire un don
        </Link>

        {canIssueTaxReceipts && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-500">
            <ShieldCheckIcon className="size-3.5 shrink-0 text-gray-400" />
            Reçu fiscal envoyé automatiquement par e-mail
          </p>
        )}
      </div>
    </section>
  )
}
