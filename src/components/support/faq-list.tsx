type FaqItem = { question: string; answer: string }

export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y rounded-lg border">
      {items.map((item, i) => (
        <details key={i} className="group p-3">
          <summary className="cursor-pointer list-none text-sm font-medium marker:content-none">
            {item.question}
          </summary>
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{item.answer}</p>
        </details>
      ))}
    </div>
  )
}
