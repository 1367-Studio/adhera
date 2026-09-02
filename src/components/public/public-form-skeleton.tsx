import { Skeleton } from "@/components/ui/skeleton"

// Loading placeholder for the public donation/membership forms — shown on first load and
// again whenever the visitor switches locale (the content is re-fetched, translated).
// Keeps the same max-w-md column shape as the real form so nothing jumps once it swaps in.
export function PublicFormSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="h-9 w-full" />
    </div>
  )
}
