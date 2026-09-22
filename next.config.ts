import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Embedded on formwise.fr under /app via form-wise-app's proxy — see its src/middleware.ts.
const nextConfig: NextConfig = {
  basePath: "/app",
  // Without this, Next's own trailing-slash normalization redirects a request to exactly
  // "/app" or "/app/" BEFORE the proxy ever runs — so an association's own custom domain
  // (rewritten to that bare basePath root by vercel.json) never reaches the customDomain
  // lookup in src/proxy.ts at all, confirmed empirically (no amount of matcher tweaking
  // made the proxy fire for that one exact path). This flag defers trailing-slash handling
  // past the proxy instead.
  skipTrailingSlashRedirect: true,
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
