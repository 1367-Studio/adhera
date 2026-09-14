import { PedidoTrackingView } from "./pedido-tracking-view"

export default async function PublicBoutiquePedidoPage(
  { params }: { params: Promise<{ slug: string; token: string }> },
) {
  const { slug, token } = await params
  return <PedidoTrackingView slug={slug} token={token} />
}
