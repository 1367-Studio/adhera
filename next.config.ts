import { withSentryConfig } from "@sentry/nextjs/config";
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

export default withSentryConfig(withNextIntl(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "1367-studio",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // On by default in @sentry/nextjs 11: runs a JS loader over every server .js file,
  // node_modules included, for automatic library *tracing* (not error capture). It took the
  // build's peak memory from 3.7 GB to 7.8 GB — past what Vercel's 8 GB build machine can
  // hold, so the build stalled in "Creating an optimized production build" for 35+ minutes.
  // Off: 4.9 GB, errors still reported exactly the same.
  buildTimeInstrumentation: false,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
