export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export function parsePagination(searchParams: URLSearchParams, defaultLimit = 20) {
  const page  = Math.max(1, parseInt(searchParams.get("page")  || "1"))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || String(defaultLimit))))
  const skip  = (page - 1) * limit
  return { page, limit, skip }
}
