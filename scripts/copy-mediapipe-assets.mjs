// Copies the MediaPipe vision WASM used by the meeting background-blur processor
// (@livekit/track-processors) out of node_modules and into public/, so the browser loads it
// from our own origin instead of the jsdelivr CDN the library defaults to.
//
// Copied rather than committed on purpose: the WASM has to match the exact
// @mediapipe/tasks-vision version @livekit/track-processors depends on, and a checked-in
// copy would silently drift the next time that dependency is bumped.
import { cp, mkdir, rm, access } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src  = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm")
const dest = join(root, "public", "mediapipe", "wasm")

try {
  await access(src)
} catch {
  // Not an error: the meeting module simply falls back to hiding the blur control.
  console.warn("[mediapipe] @mediapipe/tasks-vision not installed — skipping WASM copy")
  process.exit(0)
}

await rm(dest, { recursive: true, force: true })
await mkdir(dest, { recursive: true })
await cp(src, dest, { recursive: true })
console.log(`[mediapipe] WASM copied to ${dest}`)
