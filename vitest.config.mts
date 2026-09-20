import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Unit tests only (pure logic, no database): the `@/` alias mirrors tsconfig's
// `"@/*": ["./src/*"]` so tested modules import each other exactly as the app does.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include:     ["src/**/*.test.ts"],
    environment: "node",
  },
})
