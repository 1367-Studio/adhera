import { describe, expect, it } from "vitest"
import { normalizeAiHtml } from "@/lib/ai/normalize-html"

describe("normalizeAiHtml", () => {
  // The shape models actually return for an event description: every newline and indent
  // between tags used to turn into an empty paragraph or bullet in the Tiptap editor.
  it("drops the whitespace a model puts between block tags", () => {
    const prettyPrinted = [
      "<h2>Marathon de Paris 40 km</h2>",
      "",
      "<p>Une course exceptionnelle.</p>",
      "",
      "<h3>Informations sur l'événement</h3>",
      "<ul>",
      "  <li>",
      "    <strong>Date :</strong> [Insérer la date]",
      "  </li>",
      "  <li><strong>Lieu :</strong> Paris, France</li>",
      "</ul>",
      "<hr>",
      "<p>À bientôt !</p>",
    ].join("\n")

    expect(normalizeAiHtml(prettyPrinted)).toBe(
      "<h2>Marathon de Paris 40 km</h2>"
      + "<p>Une course exceptionnelle.</p>"
      + "<h3>Informations sur l'événement</h3>"
      + "<ul><li><strong>Date :</strong> [Insérer la date]</li><li><strong>Lieu :</strong> Paris, France</li></ul>"
      + "<hr>"
      + "<p>À bientôt !</p>",
    )
  })

  it("keeps the spaces between inline tags and words", () => {
    expect(normalizeAiHtml("<p><strong>Date :</strong> 15 avril <em>à</em> <a href=\"https://example.org\">Paris</a></p>"))
      .toBe("<p><strong>Date :</strong> 15 avril <em>à</em> <a href=\"https://example.org\">Paris</a></p>")
  })

  it("still strips a code fence around the HTML", () => {
    expect(normalizeAiHtml("```html\n<p>Bonjour</p>\n\n<p>Au revoir</p>\n```")).toBe("<p>Bonjour</p><p>Au revoir</p>")
  })

  it("wraps plain text answers in paragraphs", () => {
    expect(normalizeAiHtml("Premier paragraphe.\n\nSecond\nparagraphe.")).toBe("<p>Premier paragraphe.</p><p>Second<br>paragraphe.</p>")
  })
})
