"use client"

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"
import type { RadioField } from "@puckeditor/core"

// Subtle scroll-reveal animations for public association websites. Opt-in through
// <SiteAnimationsProvider level="subtle">: outside a provider (legacy pages, the editor with
// "none") every <SiteReveal> renders a plain, fully visible <div>.
//
// No-JS / SSR safety: the server always renders content visible. Only after mount, and only
// for elements that are still below the fold, the hidden state is applied (instantly, without
// transition) and then removed with a transition once the element scrolls into view.

export type SiteAnimationLevel = "none" | "subtle"

export const SITE_ANIMATION_FIELD: RadioField = {
  type:    "radio",
  label:   "Animations",
  options: [
    { label: "Aucune",    value: "none" },
    { label: "Discrètes", value: "subtle" },
  ],
}

const REVEAL_CLASS_NAME      = "fw-site-reveal"
const REVEAL_STATE_ATTRIBUTE = "data-fw-site-reveal"
const REVEAL_THRESHOLD       = 0.15

const SITE_ANIMATION_STYLES = `
.${REVEAL_CLASS_NAME}[${REVEAL_STATE_ATTRIBUTE}="hidden"] {
  opacity: 0;
  transform: translateY(16px);
}
.${REVEAL_CLASS_NAME}[${REVEAL_STATE_ATTRIBUTE}="shown"] {
  opacity: 1;
  transform: none;
  transition: opacity 600ms ease-out, transform 600ms ease-out;
}
.site-hover-lift {
  transition: transform 150ms ease-out;
}
.site-hover-lift:hover {
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .${REVEAL_CLASS_NAME}[${REVEAL_STATE_ATTRIBUTE}] {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .site-hover-lift,
  .site-hover-lift:hover {
    transform: none;
    transition: none;
  }
}
`

const SiteAnimationContext = createContext<SiteAnimationLevel>("none")

type SiteAnimationsProviderProps = {
  level:    SiteAnimationLevel | undefined
  children: ReactNode
}

export function SiteAnimationsProvider({ level, children }: SiteAnimationsProviderProps) {
  const animationLevel: SiteAnimationLevel = level === "subtle" ? "subtle" : "none"
  return (
    <SiteAnimationContext.Provider value={animationLevel}>
      <style>{SITE_ANIMATION_STYLES}</style>
      {children}
    </SiteAnimationContext.Provider>
  )
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function isInViewport(element: HTMLElement): boolean {
  const elementBounds = element.getBoundingClientRect()
  return elementBounds.top < window.innerHeight && elementBounds.bottom > 0
}

type SiteRevealProps = {
  children:   ReactNode
  className?: string
}

export function SiteReveal({ children, className }: SiteRevealProps) {
  const animationLevel = useContext(SiteAnimationContext)
  const revealElementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const revealElement = revealElementRef.current
    if (!revealElement || animationLevel !== "subtle") return
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return
    // Already on screen at mount: leave it visible, never make visible content blink.
    if (isInViewport(revealElement)) return

    // The state lives in a DOM attribute (not React state) so it never triggers a re-render
    // and React never overwrites it.
    revealElement.setAttribute(REVEAL_STATE_ATTRIBUTE, "hidden")
    const revealObserver = new IntersectionObserver(observedEntries => {
      if (!observedEntries.some(observedEntry => observedEntry.isIntersecting)) return
      revealElement.setAttribute(REVEAL_STATE_ATTRIBUTE, "shown")
      revealObserver.disconnect()
    }, { threshold: REVEAL_THRESHOLD })
    revealObserver.observe(revealElement)

    return () => {
      revealObserver.disconnect()
      revealElement.removeAttribute(REVEAL_STATE_ATTRIBUTE)
    }
  }, [animationLevel])

  if (animationLevel !== "subtle") return <div className={className}>{children}</div>

  const revealClassName = className ? `${REVEAL_CLASS_NAME} ${className}` : REVEAL_CLASS_NAME
  return <div ref={revealElementRef} className={revealClassName}>{children}</div>
}
