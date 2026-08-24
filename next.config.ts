import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Embedded on formwise.fr under /app via form-wise-app's proxy — see its src/middleware.ts.
const nextConfig: NextConfig = {
  basePath: "/app",
  async redirects() {
    return [
      {
        source: "/dashboard/finances/rapports",
        destination: "/dashboard/finances/rapports/compte-de-resultat",
        permanent: false,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
