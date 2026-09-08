import { BoutiqueStorefrontDetail } from "./boutique-storefront-detail"

export default async function PublicBoutiqueProduitPage(
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params
  return <BoutiqueStorefrontDetail slug={slug} id={id} />
}
