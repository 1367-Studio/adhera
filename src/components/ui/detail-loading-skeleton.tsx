// Shared loading placeholder for detail pages/views — mt-4 matches the header
// spacing standard (see evenements/[id]/presences) so content doesn't jump down
// once the real content replaces this skeleton.
export function DetailLoadingSkeleton() {
  return (
    <div className="space-y-4 mt-4 animate-pulse">
      <div className="h-8 w-64 rounded bg-muted" />
      <div className="h-40 rounded-xl bg-muted" />
    </div>
  )
}
