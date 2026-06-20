# Phase 1 — Foundation

> **Read `SYSTEM_INSTRUCTIONS.md` first.** That file governs *how* to build (stack, security, conventions, UX). This file describes *what* to build in Phase 1. If anything here seems to conflict with the master file, the master file wins.

---

## Goal of Phase 1

Build a **secure, fast, mobile-first application shell** that a user can log into — with no business features yet. When Phase 1 is done, we have:

- A deployed Next.js app on Vercel connected to Supabase.
- Working authentication (login / logout) and protected routes.
- A `companies`, `profiles`, and roles model with **Row Level Security** proven to work.
- The app shell: responsive navigation (mobile bottom nav + desktop sidebar), a **reusable modal system**, and a **reusable quick-actions system** (right-click on desktop, long-press + FAB on mobile).
- A small shared **design system** (buttons, inputs, modal, list/table, etc.).

This is the skeleton every later phase plugs into. Build it carefully — phases 2+ must only *extend* it.

---

## 1. Project Setup

1. Create a **Next.js** app (App Router, TypeScript, Tailwind CSS).
2. Create a **Supabase** project. Add the Supabase client setup in `/lib/supabase` with **two** clients:
   - a **browser client** (uses the public anon key),
   - a **server client** (for Server Components / Server Actions / Route Handlers, reads session from cookies).
3. Environment variables (never commit real values; provide `.env.example` with names only):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — never imported into client code)
4. Configure deployment to **Vercel** and set the same env vars there.
5. Set up the folder structure exactly as in `SYSTEM_INSTRUCTIONS.md` section 3.

---

## 2. Database (migrations in `/supabase/migrations`)

Create the following tables. Every table follows the conventions in the master file (uuid id, `company_id`, timestamps, `updated_at` trigger, RLS).

### `companies`
- `id uuid pk`
- `name text not null`
- `default_currency text not null default 'EGP'`
- `created_at`, `updated_at`

### `profiles`
One row per user, linked to Supabase Auth (`auth.users`).
- `id uuid pk` — equals the `auth.users` id
- `company_id uuid not null` → `companies.id`
- `full_name text`
- `role text not null default 'member'` — allowed: `admin`, `member` (designed so more roles can be added later)
- `created_at`, `updated_at`

> A new user is attached to a company and given a role. For Phase 1 it is acceptable to create the first company + admin via a simple seed or signup flow; a full invite system can come later.

### Helpers & triggers
- A trigger/function to keep `updated_at` current on every update.
- A trigger or signup handler that creates a `profiles` row when a new auth user is created.
- A SQL helper to get the current user's `company_id` and `role` (used by RLS policies).

### Row Level Security (apply to every table)
- Enable RLS on `companies` and `profiles`. **Default deny.**
- Policy: a user can read their **own company** and the profiles within it.
- Policy: only an `admin` can change company settings and other users' roles; a `member` can read but not manage.
- **Test it:** confirm that a user from company A cannot read company B's rows.

---

## 3. Authentication & Routing

- **Login page** (`/login`) using Supabase Auth (email/password to start).
- **Logout** action.
- **Protected app:** every route under the authenticated area redirects to `/login` if there is no valid session. Use middleware + server-side session checks (do not rely on client-only checks).
- After login, the user lands on a simple **Home/Dashboard** placeholder screen (just a welcome + their company name + nav — no business data yet).
- Load the user's `profile` (company + role) on entry and make it available to the app (e.g. via a server-loaded context).

---

## 4. App Shell & Navigation

Responsive layout, mobile-first:

- **Mobile:** a **bottom navigation bar** with the main sections (placeholders for now, e.g. Home, Accounts, More) and a **Floating Action Button (FAB)** "+" in the corner for quick-add.
- **Desktop:** a **sidebar** (or top bar) with the same sections, more space for content.
- Same pages render in both layouts — only the navigation chrome changes by breakpoint.
- Clean, uncluttered, big tap targets (≥44px), per the UX standards.

---

## 5. Reusable Modal System (per master file §5a)

Build **one** modal/dialog system used everywhere:

- Opens **over** the current screen; closing returns the user to exactly where they were and refreshes underlying data.
- **Responsive:** centered overlay window on desktop; **full-screen / bottom sheet** on mobile (slides up).
- Keyboard support: **Esc** closes, **Enter** submits, focus is trapped while open, focus returns on close.
- **Deep-linkable** via a URL query (e.g. `?modal=...`) so a modal can be opened directly.
- Provide a clear API so future phases can register a modal with a title + form content in a few lines.
- For Phase 1, include **one demo modal** (e.g. "Edit my profile / full name") to prove the system end-to-end.

---

## 6. Reusable Quick-Actions System (per master file §5b)

Build **one** quick-actions mechanism used everywhere:

- **Desktop:** custom **right-click context menu** inside interactive areas (lists, cards, tables). It replaces the browser menu only there — not on plain text.
- **Mobile:** **long-press** on a list item opens the same menu as a bottom sheet, and the **FAB** opens a general quick-add menu.
- **Context-aware:** the menu shows actions relevant to what was clicked (a row vs empty space), and the FAB shows the general "add" actions.
- **Role-aware:** only show actions the user's role permits.
- Selecting an action opens the matching **modal** (no page reload).
- Provide a clean API to **register actions** (label, icon, who can see it, which modal it opens) so every later phase adds its own actions without touching this system.
- For Phase 1, wire up a **demo action** (e.g. right-click → "Edit profile") to prove the mechanism. Real actions (Add Customer, Add Expense, etc.) arrive in later phases.

---

## 6a. Installable Mobile App / PWA (per master file §5c)

Make the app installable to the phone home screen as part of the foundation:

- Add a **web app manifest** (name, short name, icons in required sizes incl. a maskable icon, theme/background color, `display: standalone`, start URL, orientation).
- Register a **service worker** that caches the app shell and static assets for instant loads and graceful behaviour on a flaky connection. (No offline data sync this phase.)
- Verify **Add to Home Screen** works on Android (Chrome) and iOS (Safari): the installed app launches full-screen with its own icon and a splash screen, no browser bars.
- Add a subtle **"Install app"** button/prompt where supported.
- Respect mobile **safe areas** (notch, home indicator) so the bottom nav and FAB stay reachable.

## 7. Shared Design System (`/components`)

Build a small, consistent set of reusable components, mobile-first and RTL-ready:

- `Button` (primary / secondary / danger; large touch size)
- `Input`, `Select`, `DatePicker` (with smart defaults)
- `Modal` / `Sheet` (the system from §5)
- `ContextMenu` / `ActionMenu` (the system from §6)
- `FAB`
- `Card`, and a simple `List`/`Table` (numbers right-aligned, currency formatted)
- `Spinner` / loading + toast for success/error feedback

Define base design tokens (colors, spacing, font sizes) in Tailwind config so everything stays consistent.

---

## 8. Definition of Done (Phase 1)

- [ ] App runs locally and deploys to Vercel with no errors.
- [ ] A user can sign up / log in / log out; protected routes redirect when logged out.
- [ ] `companies` and `profiles` exist with **RLS enabled and tested** (company A cannot see company B).
- [ ] Responsive shell works: bottom nav + FAB on mobile, sidebar on desktop.
- [ ] Modal system works on both desktop (overlay) and mobile (bottom sheet), with Esc/Enter/focus handling, proven by the demo modal.
- [ ] Quick-actions system works: right-click on desktop, long-press + FAB on mobile, role-aware, proven by the demo action.
- [ ] App is installable as a PWA: "Add to Home Screen" works on Android and iOS, launches full-screen with its own icon.
- [ ] Shared components exist and are used by the above.
- [ ] Code is TypeScript, structured per master file §3, committed in clear steps.
- [ ] Nothing here will need to be rewritten for Phase 2 — Phase 2 only adds to it.

---

## 9. Explicitly NOT in Phase 1

- No bank accounts, transactions, customers, expenses, or any business data — those are Phase 2+.
- No reports/exports, no client portal, no notifications.
- The demo modal and demo action exist **only** to prove the reusable systems work; they will be joined by real features later.
