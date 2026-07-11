import type { NextConfig } from "next";

// Embedded on formwise.fr under /app via form-wise-app's proxy — see its src/middleware.ts.
const nextConfig: NextConfig = {
  basePath: "/app",
};

export default nextConfig;
