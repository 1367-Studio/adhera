import { ImageIcon } from "@sanity/icons/Image"
import { LinkIcon } from "@sanity/icons/Link"
import { defineArrayMember, defineField, defineType } from "sanity"

export const helpBody = defineType({
  name: "helpBody",
  title: "Contenu",
  type: "array",
  of: [
    defineArrayMember({
      type: "block",
      styles: [
        { title: "Paragraphe", value: "normal" },
        { title: "Titre 2", value: "h2" },
        { title: "Titre 3", value: "h3" },
        { title: "Citation", value: "blockquote" },
      ],
      lists: [
        { title: "Liste à puces", value: "bullet" },
        { title: "Liste numérotée", value: "number" },
      ],
      marks: {
        decorators: [
          { title: "Gras", value: "strong" },
          { title: "Italique", value: "em" },
          { title: "Code", value: "code" },
        ],
        annotations: [
          defineArrayMember({
            name: "link",
            title: "Lien",
            type: "object",
            icon: LinkIcon,
            fields: [
              defineField({
                name: "href",
                title: "URL",
                type: "url",
                description: "Adresse http(s) ou mailto.",
                validation: (rule) => rule.required().uri({ scheme: ["http", "https", "mailto"] }),
              }),
              defineField({
                name: "openInNewTab",
                title: "Ouvrir dans un nouvel onglet",
                type: "boolean",
                initialValue: false,
              }),
            ],
          }),
        ],
      },
    }),
    defineArrayMember({
      type: "image",
      title: "Image",
      icon: ImageIcon,
      options: { hotspot: true },
      fields: [
        defineField({
          name: "alt",
          title: "Texte alternatif",
          type: "string",
          description: "Décrit l'image pour l'accessibilité (lecteurs d'écran).",
          validation: (rule) => rule.required(),
        }),
      ],
    }),
    defineArrayMember({ type: "callout" }),
  ],
})
