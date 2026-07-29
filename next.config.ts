import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Embedded on formwise.fr under /app via form-wise-app's proxy — see its src/middleware.ts.
const nextConfig: NextConfig = {
  basePath: "/app",
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
