# Adhéra

SaaS platform for managing French associations (loi 1901). Built for presidents, secretaries, and treasurers to manage members, events, finances, and communications — with a member-facing portal included.

## Features

- **Members** — registration, status, filtering, member types
- **Events** — calendar, RSVP, attendance, location (OSM + Google Maps), paid tickets via Stripe Connect
- **Actualités** — rich text posts, image upload, recipient targeting, real-time push notifications
- **Cotisations** — annual dues tracking per member, payment status, export
- **Finances** — bank accounts, statement import (CSV/Excel) with auto column mapping, bank reconciliation with match-score engine, income/expense tracking, categories, reports & exports
- **Matériel** — equipment inventory and loan tracking
- **Dons** — online donation collection
- **Sondages** — polls/surveys creation and distribution
- **Boutique** — online store for member purchases
- **Réunions** — video meetings and general assemblies (LiveKit, with recording)
- **SMS notifications** — via your own Twilio account (BYOK, configured per association, no shared platform key)
- **Portal** — member self-service area: news feed, events with RSVP, ticket purchase, cotisation status, profile
- **Public site** — customizable association page with sections (hero, events, news, membership form, contact)
- **Notifications** — real-time push via Pusher
- **Module system** — each feature can be toggled per association without breaking others

## Stack

- **Framework:** Next.js 15 (App Router)
- **Database:** PostgreSQL + Prisma
- **Auth:** NextAuth v5
- **UI:** shadcn/ui + Tailwind v4
- **Payments:** Stripe Connect Express (1.5% platform fee)
- **Storage:** Cloudflare R2
- **Real-time:** Pusher
- **Email:** Resend
- **SMS:** Twilio (bring-your-own-key, per association)
- **Video meetings:** LiveKit
- **AI:** Groq

## Getting Started

```bash
npm install
cp .env.example .env.local
# fill in .env.local

npx prisma migrate dev
npm run dev
```

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

## Architecture

### Multi-tenancy

Each `Association` is an isolated tenant. Users belong to one association and can only access its data. A `SUPER_ADMIN` role manages associations from a separate backoffice.

### Module system

Each association has a `modules` JSON field controlling which features are active. Disabling a module:
- removes it from the sidebar
- blocks direct URL access (server-side redirect)
- hides related components and dashboard widgets
- takes the public site offline (for the `site` module)

Data is never deleted when a module is disabled — only access is restricted.

### Roles

| Role | Access |
|------|--------|
| `SUPER_ADMIN` | Backoffice — manages all associations and their modules |
| `ADMIN` / `PRESIDENT` | Full dashboard access |
| `TRESORIER` | Dashboard + treasury |
| `SECRETAIRE` | Dashboard (no treasury) |
| `MEMBRE` | Member portal only |
