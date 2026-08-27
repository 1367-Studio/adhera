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
```

Then pick a database — local or staging.

### Local database (recommended)

Requires Docker. Postgres runs in a container defined by [`docker-compose.yml`](docker-compose.yml);
everything else (Stripe, R2, Resend, Pusher, LiveKit) still uses `.env.local`.

```bash
npm run db:up        # start Postgres, wait until it accepts connections
npm run db:migrate   # apply migrations
npm run db:seed      # super admin + demo association
npm run dev:local    # Next.js against the local database
```

Seeded accounts — password `devpass` for all three:

| Account | Role |
|---------|------|
| `hello@1367studio.com` | `SUPER_ADMIN` |
| `admin@demo.fr` | `ADMIN` |
| `membre@demo.fr` | `MEMBRE` |

Other commands: `db:down` (stop the container, keep the data), `db:reset` (drop, re-migrate,
re-seed), `db:psql` (open a shell on the database).

These all go through [`scripts/local-db.sh`](scripts/local-db.sh), which overrides `DATABASE_URL`
and `DIRECT_URL` so they can only ever touch the container — never staging.

### Staging database

`npm run dev` uses the `DATABASE_URL` in `.env.local`, which points at staging. Handy for
reproducing something with real data, but be aware you are writing to a shared database.

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

## Branches & Deployment

- **`main`** — production. Deploys to the production environment, backed by the production database and the production Stripe account.
- **`developer`** — staging. Deploys to a Vercel Preview environment, backed by a separate staging database and a separate (test-mode) Stripe account, so nothing here ever touches production data or real charges.

Workflow: commit and push to `developer` first, verify the change on its preview deployment, then open a pull request from `developer` into `main` to release it to production. Don't commit straight to `main`.

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
