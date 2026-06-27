export async function portalFetch(url: string): Promise<unknown> {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? "Erreur")
  return data
}
