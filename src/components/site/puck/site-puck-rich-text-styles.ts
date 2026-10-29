// Puck's richtext output (the "Texte" block) is styled by puck.css, which also carries the
// whole editor stylesheet and an external font import. Only the rules that shape the rendered
// text are kept here. Scoped to `[data-site-puck-page]` so both the public page and the
// editor's own preview — the two places that render published/draft content read-only, outside
// Puck's own editor chrome — present text identically to how it looks while editing.
export const RICH_TEXT_STYLES = `
[data-site-puck-page] .rich-text * { white-space: pre-wrap; }
[data-site-puck-page] .rich-text p:empty::before { content: "\\a0"; }
[data-site-puck-page] .rich-text > *:first-child,
[data-site-puck-page] .rich-text * p:first-of-type { margin-top: 0; }
[data-site-puck-page] .rich-text > *:last-child,
[data-site-puck-page] .rich-text * p:last-of-type { margin-bottom: 0; }
`
