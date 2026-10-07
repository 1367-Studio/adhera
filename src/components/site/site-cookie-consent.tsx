"use client"

import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode,
} from "react"
import type { ObjectField } from "@puckeditor/core"
import { YES_NO_OPTIONS } from "@/components/site/blocks/site-block-fields"
import { cn } from "@/lib/utils"
import { SITE_UI_STRINGS, type SiteUiStrings } from "@/lib/site-puck/site-ui-strings"

// Cookie consent of the public association sites (CNIL): the only cookie-setting content is
// third-party embeds (YouTube / Vimeo videos). Refusing is as easy as accepting (two equally
// weighted buttons), nothing is pre-accepted, the choice is kept 6 months and can be changed at
// any time through "Gérer les cookies".

export type SiteCookieSettings = {
  enabled?:    boolean
  message?:    string
  privacyUrl?: string
}

export const SITE_COOKIE_FIELD: ObjectField<SiteCookieSettings> = {
  type:  "object",
  label: "Bandeau cookies",
  objectFields: {
    enabled:    { type: "radio", label: "Afficher le bandeau", options: YES_NO_OPTIONS },
    message:    { type: "textarea", label: "Message" },
    privacyUrl: { type: "text", label: "Lien vers la politique de confidentialité" },
  },
}

export type SiteCookieConsentValue = "accepted" | "refused" | "undecided"
type SiteCookieChoice = Exclude<SiteCookieConsentValue, "undecided">
type StoredSiteConsent = { value: SiteCookieChoice; savedAt: number }

const CONSENT_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000

function consentStorageKey(slug: string): string {
  return `formwise:site-consent:${slug}`
}

// ─── Consent store ────────────────────────────────────────────────────────────────────────────
// localStorage when available; an in-memory copy keeps the choice for the session when storage
// is blocked (private browsing, disabled site data).

const sessionConsentBySlug = new Map<string, StoredSiteConsent>()
const consentListeners     = new Set<() => void>()

function isValidStoredConsent(candidate: unknown): candidate is StoredSiteConsent {
  if (!candidate || typeof candidate !== "object") return false
  const storedCandidate = candidate as Partial<StoredSiteConsent>
  return (storedCandidate.value === "accepted" || storedCandidate.value === "refused")
    && typeof storedCandidate.savedAt === "number"
}

function isExpired(storedConsent: StoredSiteConsent): boolean {
  return Date.now() - storedConsent.savedAt > CONSENT_LIFETIME_MS
}

function readStoredConsent(slug: string): SiteCookieConsentValue {
  try {
    const rawValue = window.localStorage.getItem(consentStorageKey(slug))
    if (rawValue) {
      const parsedValue: unknown = JSON.parse(rawValue)
      if (isValidStoredConsent(parsedValue) && !isExpired(parsedValue)) return parsedValue.value
      window.localStorage.removeItem(consentStorageKey(slug))
    }
  } catch {
    // Blocked or corrupted storage: fall back to the session copy below.
  }
  const sessionConsent = sessionConsentBySlug.get(slug)
  if (sessionConsent && !isExpired(sessionConsent)) return sessionConsent.value
  return "undecided"
}

function writeStoredConsent(slug: string, choice: SiteCookieChoice) {
  const storedConsent: StoredSiteConsent = { value: choice, savedAt: Date.now() }
  sessionConsentBySlug.set(slug, storedConsent)
  try {
    window.localStorage.setItem(consentStorageKey(slug), JSON.stringify(storedConsent))
  } catch {
    // Storage blocked: the session copy is enough until the tab closes.
  }
  consentListeners.forEach(notifyListener => notifyListener())
}

function subscribeToConsent(onConsentChange: () => void): () => void {
  consentListeners.add(onConsentChange)
  // Another tab of the same site changed its mind.
  window.addEventListener("storage", onConsentChange)
  return () => {
    consentListeners.delete(onConsentChange)
    window.removeEventListener("storage", onConsentChange)
  }
}

function subscribeToNothing(): () => void {
  return () => {}
}

// ─── Context ──────────────────────────────────────────────────────────────────────────────────

type SiteCookieConsentContextValue = {
  consent: SiteCookieConsentValue
  accept:  () => void
  refuse:  () => void
  reopen:  () => void
  /** False outside a provider or when the banner is turned off: nothing to manage. */
  isManaged: boolean
}

function doNothing() {}

// Outside a provider (legacy pages, editor previews without one) everything behaves as before:
// embeds load directly.
const SiteCookieConsentContext = createContext<SiteCookieConsentContextValue>({
  consent:   "accepted",
  accept:    doNothing,
  refuse:    doNothing,
  reopen:    doNothing,
  isManaged: false,
})

type SiteBannerContextValue = {
  isBannerVisible: boolean
  message:         string
  privacyUrl:      string
  focusRequest:    number
  accept:          () => void
  refuse:          () => void
  ui:              SiteUiStrings
}

const SiteBannerContext = createContext<SiteBannerContextValue | null>(null)

export function useSiteCookieConsent(): SiteCookieConsentContextValue {
  return useContext(SiteCookieConsentContext)
}

type SiteCookieConsentProviderProps = {
  slug:      string
  settings?: SiteCookieSettings
  isEditing: boolean
  children:  ReactNode
  ui?:       SiteUiStrings
}

export function SiteCookieConsentProvider({ slug, settings, isEditing, children, ui = SITE_UI_STRINGS }: SiteCookieConsentProviderProps) {
  const isBannerEnabled = settings?.enabled !== false

  const storedConsent = useSyncExternalStore(
    subscribeToConsent,
    () => readStoredConsent(slug),
    // The server cannot know the visitor's choice: embeds stay behind their placeholder.
    () => "undecided" as const,
  )
  // The banner only appears once hydrated, so a returning visitor never sees it flash.
  const isHydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false)

  const [isReopened, setIsReopened]     = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)

  const accept = useCallback(() => {
    writeStoredConsent(slug, "accepted")
    setIsReopened(false)
  }, [slug])
  const refuse = useCallback(() => {
    writeStoredConsent(slug, "refused")
    setIsReopened(false)
  }, [slug])
  const reopen = useCallback(() => {
    setIsReopened(true)
    setFocusRequest(previousRequest => previousRequest + 1)
  }, [])

  const consent: SiteCookieConsentValue = isBannerEnabled ? storedConsent : "accepted"

  const consentContextValue = useMemo<SiteCookieConsentContextValue>(() => ({
    consent,
    accept,
    refuse,
    reopen:    isBannerEnabled ? reopen : doNothing,
    isManaged: isBannerEnabled,
  }), [consent, accept, refuse, reopen, isBannerEnabled])

  const isBannerVisible = isBannerEnabled && !isEditing && isHydrated && (consent === "undecided" || isReopened)

  const bannerContextValue = useMemo<SiteBannerContextValue>(() => ({
    isBannerVisible,
    message:    settings?.message?.trim() || ui.cookieDefaultMessage,
    privacyUrl: settings?.privacyUrl?.trim() ?? "",
    focusRequest,
    accept,
    refuse,
    ui,
  }), [isBannerVisible, settings?.message, settings?.privacyUrl, focusRequest, accept, refuse, ui])

  return (
    <SiteCookieConsentContext.Provider value={consentContextValue}>
      {children}
      <SiteBannerContext.Provider value={bannerContextValue}>
        <SiteCookieBanner />
      </SiteBannerContext.Provider>
    </SiteCookieConsentContext.Provider>
  )
}

// ─── Banner ───────────────────────────────────────────────────────────────────────────────────

// Both choices share the exact same style: refusing must not look secondary.
const CHOICE_BUTTON_CLASS =
  "inline-flex h-10 min-w-28 flex-1 items-center justify-center px-5 text-sm font-medium transition-opacity hover:opacity-90 sm:flex-none"

const CHOICE_BUTTON_STYLE = {
  background:   "var(--site-primary)",
  color:        "var(--site-primary-foreground)",
  borderRadius: "var(--site-radius)",
} as const

// Rendered by SiteCookieConsentProvider only.
export function SiteCookieBanner() {
  const bannerContext   = useContext(SiteBannerContext)
  const titleId         = useId()
  const messageId       = useId()
  const firstButtonRef  = useRef<HTMLButtonElement>(null)
  const focusRequest    = bannerContext?.focusRequest ?? 0
  const isBannerVisible = bannerContext?.isBannerVisible ?? false

  // Opened again from "Gérer les cookies": move keyboard focus to the choices.
  useEffect(() => {
    if (isBannerVisible && focusRequest > 0) firstButtonRef.current?.focus()
  }, [isBannerVisible, focusRequest])

  if (!bannerContext || !isBannerVisible) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
      <div
        role="dialog"
        aria-modal="false"
        aria-live="polite"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="pointer-events-auto flex w-full max-w-3xl flex-col gap-4 p-4 shadow-lg sm:flex-row sm:items-center sm:gap-6"
        style={{
          background:   "var(--site-surface)",
          color:        "var(--site-text)",
          border:       "1px solid var(--site-border)",
          borderRadius: "var(--site-radius)",
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <p id={titleId} className="font-medium">{bannerContext.ui.cookieTitle}</p>
          <p id={messageId} style={{ color: "var(--site-text-muted)" }}>
            {bannerContext.message}
            {bannerContext.privacyUrl && (
              <>
                {" "}
                <a
                  href={bannerContext.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                  style={{ color: "var(--site-text)" }}
                >
                  {bannerContext.ui.cookiePrivacyPolicy}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            ref={firstButtonRef}
            type="button"
            onClick={bannerContext.refuse}
            className={CHOICE_BUTTON_CLASS}
            style={CHOICE_BUTTON_STYLE}
          >
            {bannerContext.ui.cookieRefuse}
          </button>
          <button
            type="button"
            onClick={bannerContext.accept}
            className={CHOICE_BUTTON_CLASS}
            style={CHOICE_BUTTON_STYLE}
          >
            {bannerContext.ui.cookieAccept}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── "Gérer les cookies" ──────────────────────────────────────────────────────────────────────

// Lets visitors change their mind. Renders nothing when the banner is turned off or outside a
// provider, since there is then no choice to manage.
export function SiteCookieSettingsLink({ className, ui = SITE_UI_STRINGS }: { className?: string; ui?: SiteUiStrings }) {
  const { reopen, isManaged } = useSiteCookieConsent()
  if (!isManaged) return null
  return (
    <button
      type="button"
      onClick={reopen}
      className={cn("text-sm underline-offset-2 hover:underline", className)}
    >
      {ui.cookieManage}
    </button>
  )
}
