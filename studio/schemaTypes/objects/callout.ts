import { InfoOutlineIcon } from "@sanity/icons/InfoOutline"
import { defineField, defineType } from "sanity"

export const CALLOUT_TONES = [
  { value: "info", title: "Information" },
  { value: "warning", title: "Avertissement" },
  { value: "tip", title: "Astuce" },
]

export const callout = defineType({
  name: "callout",
  title: "Encadré",
  type: "object",
  icon: InfoOutlineIcon,
  fields: [
    defineField({
      name: "tone",
      title: "Ton",
      type: "string",
      options: { list: CALLOUT_TONES, layout: "radio", direction: "horizontal" },
      initialValue: "info",
    }),
    defineField({
      name: "text",
      title: "Texte",
      type: "text",
      rows: 3,
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { text: "text", tone: "tone" },
    prepare({ text, tone }) {
      const toneTitle = CALLOUT_TONES.find((calloutTone) => calloutTone.value === tone)?.title
      return { title: text || "Encadré", subtitle: toneTitle ?? "Information" }
    },
  },
})
