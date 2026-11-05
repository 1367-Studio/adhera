import { changelogEntry } from "./documents/changelog-entry"
import { faqEntry } from "./documents/faq-entry"
import { helpArticle } from "./documents/help-article"
import { legalDocument } from "./documents/legal-document"
import { newsEntry } from "./documents/news-entry"
import { callout } from "./objects/callout"
import { helpBody } from "./objects/help-body"

export const schemaTypes = [
  // Documents
  helpArticle,
  faqEntry,
  changelogEntry,
  newsEntry,
  legalDocument,
  // Objects
  helpBody,
  callout,
]
