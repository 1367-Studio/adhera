import { describe, expect, it } from "vitest"
import { attributionFromSearchParams, signupChannel } from "@/lib/signup-attribution"

describe("signupChannel", () => {
  it("classifies Google Ads clicks by click id or paid google medium", () => {
    expect(signupChannel({ gclid: "abc" })).toBe("Google Ads")
    expect(signupChannel({ gbraid: "abc" })).toBe("Google Ads")
    expect(signupChannel({ wbraid: "abc" })).toBe("Google Ads")
    expect(signupChannel({ utm_source: "Google", utm_medium: "CPC" })).toBe("Google Ads")
    expect(signupChannel({ utm_source: "google", utm_medium: "paid_search" })).toBe("Google Ads")
  })

  it("classifies LinkedIn, social, e-mail and AI assistants", () => {
    expect(signupChannel({ utm_source: "linkedin" })).toBe("LinkedIn")
    expect(signupChannel({ fw_ref: "www.linkedin.com" })).toBe("LinkedIn")
    expect(signupChannel({ fw_ref: "l.instagram.com" })).toBe("Réseaux sociaux")
    expect(signupChannel({ utm_source: "facebook" })).toBe("Réseaux sociaux")
    expect(signupChannel({ utm_medium: "email" })).toBe("E-mail")
    expect(signupChannel({ utm_source: "newsletter-octobre" })).toBe("E-mail")
    expect(signupChannel({ fw_ref: "chatgpt.com" })).toBe("IA (ChatGPT, Perplexity…)")
    expect(signupChannel({ utm_source: "perplexity" })).toBe("IA (ChatGPT, Perplexity…)")
  })

  it("falls back to SEO, referring site, then Direct", () => {
    expect(signupChannel({ fw_ref: "www.google.com" })).toBe("Recherche Google (SEO)")
    expect(signupChannel({ fw_ref: "www.qwant.com" })).toBe("Recherche Google (SEO)")
    expect(signupChannel({ fw_ref: "blog.example.org" })).toBe("Site référent")
    expect(signupChannel({})).toBe("Direct")
    expect(signupChannel(undefined)).toBe("Direct")
  })

  it("prefers Google Ads over an organic google referrer", () => {
    expect(signupChannel({ gclid: "abc", fw_ref: "www.google.com" })).toBe("Google Ads")
  })
})

describe("attributionFromSearchParams", () => {
  it("keeps only known, non-empty params, sliced to 200 chars", () => {
    const searchParams = new URLSearchParams({ tier: "pro", utm_source: "google", utm_term: "", fw_click: "x".repeat(250) })
    expect(attributionFromSearchParams(searchParams)).toEqual({ utm_source: "google", fw_click: "x".repeat(200) })
  })

  it("returns null when no attribution param is present", () => {
    expect(attributionFromSearchParams(new URLSearchParams({ tier: "pro", plan: "yearly" }))).toBeNull()
  })
})
