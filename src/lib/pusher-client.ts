import Pusher from "pusher-js"

let client: Pusher | null = null
let attempted = false

// `pusher-js`'s constructor throws synchronously if the key is missing. A missing/blank
// NEXT_PUBLIC_PUSHER_KEY should just disable real-time updates, not crash whatever
// component mounted the subscription (there's no error boundary around it in this app).
export function getPusherClient(): Pusher | null {
  if (client || attempted) return client
  attempted = true
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY
  if (!key) return null
  try {
    client = new Pusher(key, {
      cluster:      process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      authEndpoint: "/api/pusher/auth",
    })
  } catch {
    client = null
  }
  return client
}
