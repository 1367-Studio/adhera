import Pusher from "pusher-js"
import { BASE_PATH } from "@/lib/env"

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
      authEndpoint: `${BASE_PATH}/api/pusher/auth`,
    })
    // Temporary diagnostic logging for the "no completion toast" investigation — remove once
    // the bulk-send-completed delivery gap is found. Logs every connection state transition
    // and any subscription/auth error, none of which otherwise surface anywhere.
    client.connection.bind("state_change", (states: { previous: string; current: string }) => {
      console.log("[pusher] connection state:", states.previous, "->", states.current)
    })
    client.connection.bind("error", (err: unknown) => {
      console.error("[pusher] connection error:", err)
    })
  } catch (err) {
    console.error("[pusher] client construction failed:", err)
    client = null
  }
  return client
}
