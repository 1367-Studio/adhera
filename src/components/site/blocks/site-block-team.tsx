import type { ComponentConfig } from "@puckeditor/core"
import { imageField } from "@/components/site/blocks/site-block-fields"
import {
  SECTION_STYLE_DEFAULTS, SECTION_STYLE_FIELDS, SiteBlockSection, mutedTextStyle,
  type SectionStyleProps,
} from "@/components/site/blocks/site-block-section"
import { cn } from "@/lib/utils"

// "Équipe / Bureau": the people behind the association, with an initials fallback when no
// photo has been uploaded.

export type TeamMember = { photo: string; name: string; role: string; email: string }
export type TeamColumns = "3" | "4"
export type TeamPhotoShape = "round" | "square"

export type TeamBlockProps = SectionStyleProps & {
  title:      string
  intro:      string
  members:    TeamMember[]
  columns:    TeamColumns
  photoShape: TeamPhotoShape
}

const GRID_CLASSES: Record<TeamColumns, string> = {
  "3": "grid-cols-2 md:grid-cols-3",
  "4": "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
}

function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(namePart => namePart[0]?.toUpperCase() ?? "")
    .join("")
}

export const teamBlock: ComponentConfig<TeamBlockProps> = {
  label: "Équipe / Bureau",
  fields: {
    title: { type: "text", label: "Titre", contentEditable: true },
    intro: { type: "textarea", label: "Introduction", contentEditable: true },
    members: {
      type:             "array",
      label:            "Membres",
      max:              24,
      arrayFields: {
        photo: imageField("Photo"),
        name:  { type: "text", label: "Nom" },
        role:  { type: "text", label: "Fonction" },
        email: { type: "text", label: "E-mail (facultatif)" },
      },
      defaultItemProps: { photo: "", name: "Prénom Nom", role: "", email: "" },
      getItemSummary:   teamMember => teamMember.name || "Membre",
    },
    columns: {
      type:    "radio",
      label:   "Colonnes",
      options: [
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    photoShape: {
      type:    "radio",
      label:   "Forme des photos",
      options: [
        { label: "Ronde",  value: "round" },
        { label: "Carrée", value: "square" },
      ],
    },
    ...SECTION_STYLE_FIELDS,
  },
  defaultProps: {
    title:   "Le bureau",
    intro:   "Une équipe de bénévoles engagés fait vivre l'association tout au long de l'année.",
    members: [
      { photo: "", name: "Claire Martin",   role: "Présidente",     email: "" },
      { photo: "", name: "Julien Bernard",  role: "Trésorier",      email: "" },
      { photo: "", name: "Sophie Laurent",  role: "Secrétaire",     email: "" },
    ],
    columns:    "3",
    photoShape: "round",
    ...SECTION_STYLE_DEFAULTS,
  },
  render: ({ title, intro, members, columns, photoShape, background, spacing, width, puck }) => {
    const visibleMembers = members.filter(teamMember => teamMember.name?.trim() || teamMember.photo)
    const isRound        = photoShape === "round"
    const photoClass     = cn("aspect-square w-full object-cover", isRound && "rounded-full")
    const photoStyle     = isRound ? undefined : { borderRadius: "var(--site-radius)" }

    return (
      <SiteBlockSection background={background} spacing={spacing} width={width}>
        {(title || intro) && (
          <div className="mb-10 max-w-2xl">
            {title && <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>}
            {intro && <p className="mt-3 whitespace-pre-line text-base" style={mutedTextStyle(background)}>{intro}</p>}
          </div>
        )}

        {visibleMembers.length === 0 && puck.isEditing && (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ background: "var(--site-surface-muted)", color: "var(--site-text-muted)", borderRadius: "var(--site-radius)" }}
          >
            Ajoutez les membres de l&apos;équipe dans le panneau de droite.
          </div>
        )}

        {visibleMembers.length > 0 && (
          <ul className={cn("grid gap-x-6 gap-y-10", GRID_CLASSES[columns])}>
            {visibleMembers.map((teamMember, memberIndex) => (
              <li key={memberIndex} className="flex flex-col items-center text-center">
                <div className={cn("w-full", isRound && "max-w-40")}>
                  {teamMember.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={teamMember.photo} alt={teamMember.name} loading="lazy" className={photoClass} style={photoStyle} />
                  ) : (
                    <div
                      aria-hidden="true"
                      className={cn("flex aspect-square w-full items-center justify-center text-2xl font-semibold", isRound && "rounded-full")}
                      style={{ ...photoStyle, background: "var(--site-surface-muted)", color: "var(--site-text-muted)" }}
                    >
                      {initialsOf(teamMember.name ?? "")}
                    </div>
                  )}
                </div>
                <p className="mt-4 text-base font-semibold">{teamMember.name}</p>
                {teamMember.role && <p className="mt-1 text-sm" style={mutedTextStyle(background)}>{teamMember.role}</p>}
                {teamMember.email?.trim() && (
                  <a
                    href={`mailto:${teamMember.email.trim()}`}
                    className="mt-2 break-all text-sm underline-offset-4 hover:underline"
                    style={mutedTextStyle(background)}
                  >
                    {teamMember.email.trim()}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </SiteBlockSection>
    )
  },
}
