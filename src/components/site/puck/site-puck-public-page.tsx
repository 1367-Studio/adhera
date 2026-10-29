"use client"

import { Component, Suspense, type ErrorInfo, type ReactNode } from "react"
import { Render } from "@puckeditor/core"
import { sitePuckConfig } from "@/components/site/puck/site-puck-config"
import { RICH_TEXT_STYLES } from "@/components/site/puck/site-puck-rich-text-styles"
import type { SitePuckMetadata } from "@/components/site/blocks/site-block-types"
import type { SitePuckData } from "@/lib/site-puck/site-puck-data"

// The public homepage of a site published from the new builder (FORM-7): the same <Render> as
// the editor's full-page preview, fed with the live data the server already loaded.
//
// Any failure while rendering falls back to `legacyFallback` — the old builder's page, rendered
// on the server — never to an error page. A server-side render error stays inside the Suspense
// boundary (React then retries on the client), where the error boundary catches it.

type RenderErrorBoundaryProps = { fallback: ReactNode; children: ReactNode }

class RenderErrorBoundary extends Component<RenderErrorBoundaryProps, { hasFailed: boolean }> {
  state = { hasFailed: false }

  static getDerivedStateFromError() {
    return { hasFailed: true }
  }

  componentDidCatch(renderError: Error, errorInfo: ErrorInfo) {
    console.error("[site-puck-public-page] render failed, showing the old builder's page", renderError, errorInfo.componentStack)
  }

  render() {
    return this.state.hasFailed ? this.props.fallback : this.props.children
  }
}

type SitePuckPublicPageProps = {
  publishedData:  SitePuckData
  metadata:       SitePuckMetadata
  legacyFallback: ReactNode
}

export function SitePuckPublicPage({ publishedData, metadata, legacyFallback }: SitePuckPublicPageProps) {
  return (
    <Suspense fallback={legacyFallback}>
      <RenderErrorBoundary fallback={legacyFallback}>
        <style href="site-puck-rich-text" precedence="default">{RICH_TEXT_STYLES}</style>
        <div data-site-puck-page="" className="min-h-screen bg-white">
          <Render config={sitePuckConfig} data={publishedData} metadata={metadata} />
        </div>
      </RenderErrorBoundary>
    </Suspense>
  )
}
