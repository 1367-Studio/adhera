import type { Metadata } from "next"
import localFont from "next/font/local"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
import { ThemeProvider } from "@/components/layout/theme-provider"
import { Providers } from "@/components/layout/providers"
import { Toaster } from "@/components/ui/sonner"
import { TopLoader } from "@/components/top-loader"
import { APP_NAME } from "@/config/brand"
import { BASE_PATH } from "@/lib/env"
import "./globals.css"

// Only the weights the UI actually uses (font-normal/medium/semibold/bold + italic notes).
const lausanne = localFont({
  src: [
    { path: "./fonts/TWKLausannePan-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/TWKLausannePan-400Italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/TWKLausannePan-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/TWKLausannePan-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/TWKLausannePan-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Gestion simplifiée pour associations françaises",
  // Les fichiers de public/ sont servis sous basePath : on préfixe à la main, comme dans manifest.ts.
  icons: {
    icon: [
      { url: `${BASE_PATH}/favicon.ico`, sizes: "any" },
      { url: `${BASE_PATH}/favicon-32x32.png`, sizes: "32x32", type: "image/png" },
      { url: `${BASE_PATH}/favicon-16x16.png`, sizes: "16x16", type: "image/png" },
    ],
    apple: `${BASE_PATH}/apple-touch-icon.png`,
  },
  // Chrome's built-in auto-translate rewrites text nodes in place, which then collides with
  // React's own DOM diffing (surfaces as "Failed to execute 'insertBefore'/'removeChild' on
  // 'Node'" crashes) — this meta tag is the documented way to make Chrome skip the translate
  // offer for this page entirely instead of chasing that race after the fact.
  other: { google: "notranslate" },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={lausanne.variable} translate="no" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased" suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <TopLoader />
            <Providers>{children}</Providers>
            <Toaster position="bottom-right" richColors />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
