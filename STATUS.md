# Adhéra — Status do Projeto

> Produto SaaS multi-tenant para gestão de associations françaises.
> Atualizado em: 2026-06-22

---

## Stack

Idêntica ao eduwise (projeto de referência em `/home/jonathan/projetos/studio/eduwise`):

- **Framework:** Next.js (App Router)
- **DB:** PostgreSQL (`adhera`) + Prisma
- **UI:** shadcn/ui + Tailwind CSS + Base UI
- **Auth:** NextAuth
- **Server state:** React Query (@tanstack/react-query)
- **Forms:** react-hook-form + Zod
- **Ícones:** lucide-react
- **Notificações toast:** sonner
- **Notificações real-time:** Pusher

---

## Conceito

Adhéra é um SaaS multi-tenant para associações francesas (associations loi 1901 e similares).
Cada association tem seu próprio slug/tenant. Dois tipos de usuário:

1. **Gestores** (dashboard) — dirigentes que administram a association
2. **Membros** (portal) — os adherents que acessam sua área pessoal

---

## Roles

| Role | Acesso |
|---|---|
| `ADMIN` | Dashboard completo + configurações |
| `PRÉSIDENT` | Dashboard completo |
| `TRÉSORIER` | Dashboard + módulo financeiro |
| `SECRÉTAIRE` | Dashboard + membros + eventos |
| `MEMBRE` | Portal do membro apenas |

---

## Infraestrutura

| Item | Descrição | Status |
|---|---|---|
| Scaffold | package.json, tsconfig, next.config, eslint, postcss | ✅ Feito |
| Prisma schema | Association, User, Membre, Evenement, Participation, Cotisation, TresorerieEntry, Notification | ✅ Feito |
| Auth | NextAuth v5 + JWT + Credentials + /login | ✅ Feito |
| Layout dashboard | Sidebar collapsible, Header, ThemeToggle, NotificationBell (Pusher), UserMenu | ✅ Feito |
| Seed | Association "demo", user admin@demo.fr / admin123 | ✅ Feito |
| Banco de dados | PostgreSQL `adhera` (DATABASE_URL configurado) | ✅ Feito |
| Componentes UI | shadcn/ui copiados do eduwise | ✅ Feito |

---

## Módulos — Dashboard (gestores)

| Módulo | Descrição | Status |
|---|---|---|
| Tableau de bord | Stats gerais: membros ativos, eventos próximos, saldo | ✅ Feito |
| Membres | CRUD de membros + status (actif / inactif / suspendu) | ✅ Feito |
| Événements | Criar e gerir eventos, lista de presença simplificada | ✅ Feito |
| Cotisations | Registrar pagamentos, ver inadimplentes | ✅ Feito |
| Trésorerie | Lançar entradas/saídas, ver saldo | ✅ Feito |
| Paramètres | Configurações da association | ✅ Feito |

## Módulos — Portal do Membro

| Módulo | Descrição | Status |
|---|---|---|
| Mon profil | Ver e editar dados pessoais | ✅ Feito |
| Mes événements | Eventos inscritos e próximos | ✅ Feito |
| Ma cotisation | Status e histórico de pagamentos | ✅ Feito |

---

## Padrões de UI (herdados do eduwise)

- Sidebar shadcn collapsível por ícone (`collapsible="icon"`, `variant="inset"`)
- Header sticky com breadcrumb automático + ThemeToggle + UserMenu + NotificationBell
- Nav filtrado por role, com badges de contadores (pendentes/alertas)
- Tables paginadas com server-side filtering
- Modais com react-hook-form + Zod
- Dark/light theme (sky blue em vez do indigo do eduwise)

---

## Fora do escopo — v1

- Renovação anual de ciclo (phase 2)
- AI bot
- Turmas/grupos, notas, professores (não se aplica)

---

## Legenda

- ✅ Feito
- 🚧 Em progresso
- ⏳ Planejado
