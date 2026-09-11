import { defineCliConfig } from "sanity/cli"

export default defineCliConfig({
  api: { projectId: "uxyclro2", dataset: "production" },
  deployment: {
    appId: 'wuyduu6t5yd2hntdx2p94oxz',
  },
  typegen: {
    enabled: true,
    path: "../src/**/*.{ts,tsx}",
    schema: "schema.json",
    generates: "../src/sanity/sanity.types.ts",
    overloadClientMethods: true,
  },
})
