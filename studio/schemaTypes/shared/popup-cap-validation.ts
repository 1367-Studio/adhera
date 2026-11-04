import type { ValidationContext } from "sanity"

const API_VERSION = "2026-09-11"
// Mirrors the `[0...10]` slice in the popup GROQ queries (src/sanity/queries.ts) — the popup
// only ever shows the first this-many entries (by the same ordering), so flagging more than
// this many documents for pop-up is a silent no-op past the cap, not an error.
const POPUP_QUERY_CAP = 10

// Warns (non-blocking) when checking "Afficher dans une pop-up" pushes a content type past the
// number of entries its pop-up query actually shows. Nothing else surfaces this today — the
// query silently drops the rest — so without this an editor has no way to know their entry may
// never be shown.
export function createPopupCapWarning(docType: string) {
  return async (showInPopup: boolean | undefined, context: ValidationContext) => {
    if (!showInPopup) return true

    const currentId = (context.document?._id ?? "").replace(/^drafts\./, "")
    const client = context.getClient({ apiVersion: API_VERSION })
    const countOthers: number = await client.fetch(
      `count(*[_type == $docType && showInPopup == true && !(_id in path("drafts.**")) && _id != $currentId])`,
      { docType, currentId },
    )

    // +1 for this document itself, since it isn't published yet while being edited as a draft.
    if (countOthers + 1 > POPUP_QUERY_CAP) {
      return `Déjà ${countOthers} autre(s) entrée(s) avec « Afficher dans une pop-up » activé — la pop-up n'en affiche que les ${POPUP_QUERY_CAP} premières. Celle-ci pourrait ne jamais s'afficher.`
    }
    return true
  }
}
