# System Instructions — Construction Company Management System

> **Purpose of this file:** This is the master rulebook for building the system. Antigravity (the AI coding agent) must read and follow this file for **every** task. It defines the stack, conventions, security rules, UX standards, and how we build in phases. Specific phase specs live in separate `PHASE_*.md` files and always defer to this file for global rules.

---

## 1. Project Overview

We are building a management system for a construction company. It is built **in phases**, where each phase is a complete, working, shippable piece. The system is built around one central unit — the **Company** — and everything (accounts, transactions, and later projects, expenses, etc.) belongs to a company.

The first functional area is **Accounting**, starting with **Bank Accounts & Balances**. Later phases add more accounting, then projects, procurement, and so on. See the Roadmap (section 9).

### Product principles (non-negotiable)
1. **Fast.** Pages load quickly and feel instant. No heavy libraries when a light one works.
2. **Mobile-first.** Designed for phones first, then enhanced for desktop. Some screens are used mainly on mobile (data entry on the spot), others mainly on desktop (review, reports).
3. **Secure.** Every table is protected. Users only ever see data they are allowed to see.
4. **Easy to use — input on the spot.** A user standing in the field or at a desk must be able to record something in seconds: few taps, big buttons, minimal typing, smart defaults.

---

## 2. Tech Stack (fixed — do not substitute)

- **Frontend & hosting:** Next.js (App Router, TypeScript) deployed on **Vercel**.
- **Backend / database / auth / storage:** **Supabase** (PostgreSQL, Supabase Auth, Storage, Row Level Security, Realtime if needed).
- **Styling:** Tailwind CSS. Use a small, consistent component set (build our own simple UI components; do not pull in a heavy UI framework).
- **Forms & validation:** React Hook Form + Zod (validate on both client and server).
- **Data fetching:** Supabase client. Use Server Components for reads where possible; use Server Actions or Route Handlers for writes.
- **Language:** TypeScript everywhere. No plain `.js` files in app code.

> If a library is not listed here, prefer not to add it. If one is truly needed, it must be lightweight and justified in a code comment.

---

## 3. Architecture & Folder Conventions

Use a clean, predictable structure so future phases drop in without rewrites:

```
/app                # Next.js routes (App Router)
  /(auth)           # login, etc.
  /(app)            # authenticated app shell + pages
/components         # reusable UI components
/lib                # supabase clients, helpers, validators
  /supabase         # browser + server client setup
  /validators       # Zod schemas
/types              # shared TypeScript types
/supabase
  /migrations       # SQL migrations (one file per change, never edited after applied)
```

### Database conventions (apply to every table)
- Primary key: `id uuid default gen_random_uuid()`.
- **Every business table includes `company_id uuid not null`** referencing the company. This is mandatory from day one — it makes the system safe to grow into multiple companies later without rewrites.
- Timestamps: `created_at timestamptz default now()` and `updated_at timestamptz default now()` (auto-updated via trigger).
- Soft delete where useful: `deleted_at timestamptz` (null = active). Do not hard-delete financial records.
- Audit: store `created_by uuid` (the user) on records that users create.
- **Money:** store as `numeric(14,2)`. Never use floating point for money. Always store the **currency** alongside any amount.
- Naming: tables `snake_case` and plural (`bank_accounts`, `transactions`); columns `snake_case`.

### The "additive only" rule (critical for phased building)
- Each new phase **extends** the system — it adds new tables, columns, and links. It must **not rewrite or break** working tables from earlier phases.
- New features connect to old ones **by reference** (e.g. a future expense points to an existing `bank_account`). We never rebuild an old table to add a new feature.
- Database changes are always **new migration files**. Never edit a migration that has already been applied.

---

## 4. Security Rules (non-negotiable)

- **Authentication:** Supabase Auth. No app page (except login) is accessible without a valid session.
- **Row Level Security (RLS):** enabled on **every** table. Default deny. A user can only read/write rows where `company_id` matches their company, and only according to their role.
- **Roles:** at minimum `admin` (full access) and `member` (limited). Store role per user (e.g. a `profiles` or `company_users` table). Design so more roles can be added later.
- **Keys:** the Supabase **service role key is server-only** — never shipped to the browser or committed. Only the public anon key is used client-side, and it relies on RLS for protection.
- **Secrets:** all secrets in environment variables (`.env.local` locally, Vercel/Supabase env in production). Never commit secrets. Provide a `.env.example` with names only.
- **Validation:** validate and authorize every write on the server. Never trust the client.
- **No raw SQL from the client.** Writes go through Server Actions/Route Handlers or RLS-protected Supabase calls.

---

## 5. UX & Mobile-First Standards

- **Design for a phone screen first** (~375px wide), then scale up to tablet and desktop. Use a responsive layout; never a separate mobile site.
- **Big tap targets:** interactive elements at least 44×44px. Primary action button is large, fixed/easy to reach (bottom of screen on mobile).
- **Minimal typing:** prefer pickers, toggles, and selects over free text. Pre-fill smart defaults (today's date, current user, last-used account, default currency).
- **On-the-spot input:** the "add" flow for any record should be reachable in **one tap** from the main screen and completable in a few seconds.
- **Fast feedback:** show success/failure instantly; optimistic UI where safe.
- **Mobile vs desktop screens:** some pages are *entry-focused* (used mainly on mobile — quick add forms, recording a transaction) and some are *review-focused* (used mainly on desktop — tables, reports, dashboards). Each page must work on both, but is **optimized for its primary device**.
- **Clarity:** clean, uncluttered screens. Show the most important number (e.g. account balance) big and first.
- **Numbers & money:** always display the currency and use thousands separators. Right-align numbers in tables.
- **Language/RTL:** build the UI so it can support Arabic / right-to-left later (use logical CSS properties, avoid hard-coded left/right). Default language can be confirmed per build.

### 5a. Modals / Pop-up Windows
Many actions open in a **pop-up window (modal/dialog)** instead of navigating to a new page. This keeps the user in context and makes the app feel fast and easy.

- Use modals for quick, focused tasks: **add/edit a customer, add an expense, add a transaction, add a bank account**, and similar short forms.
- A modal opens **over** the current screen without losing it. Closing it returns the user exactly where they were, and the underlying data refreshes.
- Modals must be **fast to open** (no heavy loading), keyboard-friendly (Esc to close, Enter to submit), and trap focus while open.
- **Mobile behaviour:** on phones, a modal becomes a **full-screen sheet or bottom sheet** (slides up from the bottom) so it's thumb-reachable — never a tiny centered box. Same component, responsive behaviour.
- Modals should be **deep-linkable where it makes sense** (e.g. `?modal=add-expense`) so a quick-add can be opened directly, including from the quick-action menu below.
- Long forms or full records (e.g. a detailed report or a full project view) still use real pages — modals are for quick/focused tasks, not everything.

### 5b. Quick Actions — Right-Click (desktop) & Long-Press / FAB (mobile)
The user must be able to start common actions from almost anywhere, without hunting through menus.

- **Desktop:** **right-click** opens a custom context menu with relevant quick actions — e.g. **Add Customer, Add Expense, Add Transaction, Add Bank Account**. The menu is **context-aware**: right-clicking a customer row offers customer actions; right-clicking an account offers account/transaction actions; right-clicking empty space offers the general "add" actions.
- Selecting a quick action opens the matching **modal** (section 5a) — no page reload.
- **Mobile:** there is no right-click, so the equivalents are: a **long-press** on a list item opens the same context menu (as a bottom sheet of actions), and a persistent **Floating Action Button (FAB)** in the corner opens a quick "add" menu (Add Customer / Add Expense / …) from any main screen.
- The custom right-click menu replaces the browser's default menu **only inside the app's interactive areas** (lists, cards, tables) — not on plain text the user may want to copy.
- **Security still applies:** quick actions only show options the user's role is allowed to perform. A `member` never sees an action they can't do.
- Build this as a **single reusable quick-actions system** (one menu definition + one modal system) so every future phase can register its own actions without rebuilding the mechanism.

### 5c. Installable Mobile App (PWA)
The web app must be installable on a phone so it behaves like a native app, with a **shortcut/icon on the home screen** for one-tap access.

- Build the app as a **Progressive Web App (PWA)**: a web app manifest + a service worker.
- **Manifest:** app name, short name, **app icons** (multiple sizes, incl. maskable), theme + background color, `display: standalone` (opens full-screen with no browser address bar), correct start URL and orientation.
- **Add to Home Screen:** installable on Android (Chrome) and iOS (Safari "Add to Home Screen"). After install it launches like an app with its own icon and splash.
- **Service worker:** cache the app shell and static assets so it loads instantly and tolerates a brief loss of connection. (Full offline data sync is out of scope for now — just fast loads and graceful handling when the network is flaky.)
- Show a subtle **"Install app"** prompt/button where the browser allows it, so users can add the shortcut easily.
- The standalone app must respect safe areas (notches, home indicator) and keep the FAB and bottom nav reachable.

---

## 6. Code Quality & Workflow

- Keep components small and focused. Reuse the shared UI components in `/components`.
- Strong typing: no `any` unless unavoidable and commented.
- Every database write is wrapped in clear error handling with a user-friendly message.
- Commit work in small, logical steps with clear messages.
- After building a phase, confirm: it runs, the happy path works on mobile and desktop, and RLS actually blocks unauthorized access (test by trying to read another company's data).
- Do not start the next phase until the current one is confirmed working.

---

## 7. Money & Currency Decision (default — confirm with owner)

- The system is **multi-currency capable**: every account and every amount stores a currency code (e.g. `EGP`, `USD`).
- **Default currency: EGP** (change here if needed).
- **Balances are calculated from transactions, not typed manually.** Each account has an **opening balance**; the **current balance = opening balance + sum of its transactions**. This is the correct accounting approach and prevents errors. (If the owner prefers manual balances for now, note it here — but auto-calculation is strongly recommended.)

---

## 8. Definition of "Done" for any phase

A phase is done when:
1. It runs locally and deploys to Vercel without errors.
2. All its tables have RLS enabled and tested.
3. The main flows work on both a phone-sized screen and desktop.
4. Inputs are fast and validated.
5. It does not break or modify earlier phases (only extends them).
6. Code is typed, structured per section 3, and committed.

---

## 9. Phase Roadmap (high level)

- **Phase 1 — Foundation:** Next.js + Supabase project setup, auth, profiles/roles, RLS baseline, app shell + navigation (mobile bottom nav + desktop layout), shared UI components, design system. *(No business features yet — just a secure, working, mobile-first shell you can log into.)*
- **Phase 2 — Bank Accounts & Balances:** create/edit/list bank accounts, transactions (deposit/withdrawal), auto-calculated balances, accounts dashboard with total cash. *(First functional accounting piece.)*
- **Phase 3 — Accounting (expanded):** categories, transfers between accounts, more reporting. *(Extends Phase 2 by reference.)*
- **Phase 4+ —** Projects, expenses linked to accounts, procurement/inventory, client views, reports/exports. *(To be detailed later.)*

> Each phase gets its own `PHASE_N_*.md` spec file. Those files describe *what* to build; **this file always governs *how*.**

---

## 10. Working Agreement with Antigravity

1. Read this file fully before any task.
2. Build only the phase you are asked to build. Do not jump ahead.
3. Obey the additive-only rule (section 3) — never rewrite working code to add a feature.
4. When something is ambiguous, choose the option most consistent with the four product principles (fast, mobile-first, secure, easy on-the-spot input) and leave a clear `// NOTE:` comment explaining the choice.
5. Never weaken security to make something easier.

---

## 11. Core Business Rules

1. **Payment Settlement:** 
   - A payment can be allocated to a **specific project** or be **general**.
   - If it is for a **specific project**, it will settle amounts (invoices/dues) for that project **only**.
   - If it is a **general** payment, it will settle any outstanding amount for that specific user/client across any of their projects.
