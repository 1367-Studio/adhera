import { RoomServiceClient } from "livekit-server-sdk"
import type { LiveKitConfig } from "./config"
import { reportError } from "@/lib/monitoring"

// How long LiveKit keeps a room alive after it empties out before firing `room_finished`
// (the event our webhook uses to auto-close meetings nobody explicitly ended). LiveKit's own
// default for this is much shorter — a brief network blip or someone closing their laptop
// was enough to tear the room down and permanently lock the meeting (status flips to ENDED,
// which the token route then refuses to reissue tokens for), forcing a whole new meeting to
// be created just to let people back in. Ten minutes is a real-world grace period to get back
// online without going anywhere near "this meeting is actually still going on, unattended".
const DEPARTURE_TIMEOUT_SECONDS = 600

export function makeRoomServiceClient(livekit: LiveKitConfig) {
  return new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret)
}

// Rooms are otherwise auto-created by LiveKit on first join (whoever holds a valid token),
// which uses the server's default departureTimeout — we need our own value instead, so the
// room has to be created explicitly before anyone actually joins with it. Idempotent: calling
// createRoom on a room that already exists is a no-op that just returns its current info, so
// this is safe to call on every token issuance rather than only on the very first one.
export async function ensureRoomReconnectGrace(livekit: LiveKitConfig, roomName: string) {
  try {
    await makeRoomServiceClient(livekit).createRoom({
      name:             roomName,
      departureTimeout: DEPARTURE_TIMEOUT_SECONDS,
    })
  } catch (err) {
    // Never block a join over this — worst case the room falls back to LiveKit's default
    // departureTimeout instead of ours.
    reportError(err, { area: "api", action: "livekit.ensure-room-reconnect-grace", extra: { roomName } })
  }
}
