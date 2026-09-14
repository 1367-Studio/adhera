// If it's already HTML (from RichTextEditor), pass it through. Otherwise convert plain-text
// line breaks to <br> so values saved before the site builder used a rich text editor still
// render correctly.
export function toHtml(content: string): string {
  if (!content) return ""
  if (content.trimStart().startsWith("<")) return content
  return content.replace(/\n/g, "<br>")
}
