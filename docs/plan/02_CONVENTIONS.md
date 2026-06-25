# MAF — Conventions, Tech Stack & Guardrails

> Every phase's acceptance criteria reference this file. These rules are **mandatory**, not suggestions. They exist to keep the app fast, secure, and free of the old build's mistakes.

## 1. Stack

- **Framework:** Next.js (App Router) — the version installed in `node_modules`. ⚠️ Read `node_modules/next/dist/docs/` before writing route/server code; APIs differ from training data (see `AGENTS.md`).
- **DB/Auth/Realtime:** Supabase (Postgres). Existing project/keys in `.env.local` — **reuse, do not recreate**.
- **File storage:** Cloudflare R2 via `lib/r2.ts` (existing, keep). Attachments only store the R2 key.
- **Styling:** Tailwind, RTL, Arabic. Existing `components/ui/*` primitives are the base.
- **Data grid (the "professional table"):** **TanStack Table v8** + **TanStack Virtual** for virtualized rows. All list screens (ledger, statements, claims, expenses) use it so thousands of rows scroll smoothly on mobile. Server-side pagination/filter/sort for large sets; never `select('*')` an unbounded table into the client.
- **Validation:** Zod schemas in `lib/validators/*` (one per domain), shared by forms + server actions.
- **PWA:** installable, offline shell, home-screen icon, biometric prompt.

## 2. Performance rules (from `AGENTS.md`, enforced)

1. **Cache shared server fetches** with `React.cache()` (`lib/supabase/get-profile.ts` pattern) — user/profile/permissions fetched once per request.
2. **Parallelize independent queries** with `Promise.all([...])` — never sequential awaits that don't depend on each other.
3. **Cache R2 signed URLs** (`getBatchSignedUrls`) — never regenerate per render.
4. **Wrap `useSearchParams()` components in `<Suspense>`.**
5. **`<Link>` for navigation**, not `router.push()` for static routes.
6. **Derive balances from the ledger** via SQL aggregation / DB views, not by pulling rows to the client and summing in JS.

## 3. Database Security & Conventions

- One concern per migration; **migrations are append-only** — never edit a shipped migration, always add a new one. No "restore/simplify/fix" churn: if the model must change, update `01_DATA_MODEL.md` first and discuss.
- Use **Postgres views** for read models: `v_bank_account_balances`, `v_project_financial_position`, `v_employee_custody_balance`, `v_vendor_account`, `v_claim_totals`. Pages read views, not ad-hoc joins.
- **Money math runs in Postgres** (numeric), not JS floats. Totals on documents (`invoices.total`, claim totals) are computed by triggers or generated columns so they can't drift.
- **Row-Level Security (RLS)** is enabled on all tables. 
- Use the `public.is_super_admin()` and `public.has_project_access()` functions to secure rows.
- **Sensitive Employee Data**: Columns like `pin_hash` and `failed_pin_attempts` must never exist on `public.employees`. They must be isolated in `public.employee_secrets` which has RLS enabled with **no authenticated policies**, forcing access to happen strictly via the `service_role` on the server.
- **Views**: All views MUST be created or altered with `security_invoker = true` to ensure they respect the RLS policies of the calling user rather than the creator.
- **Auto-Timestamps**: Always attach the `set_updated_at` trigger to any table possessing an `updated_at` column.

## 4. Security

- **Auth model:** Supabase auth identity per employee using a synthetic email `username@maf.local`. The **6-digit PIN** is verified by our server (bcrypt `pin_hash`) with **lockout** (`failed_pin_attempts`, `locked_until`) — e.g. lock 15 min after 5 fails. Passkeys (WebAuthn) are the primary login; PIN is fallback.
- **Single active session:** on login, rotate `employees.active_session_id`; middleware rejects requests whose session ≠ active.
- **All mutations are server actions** behind permission checks; never trust client-sent project/permission scope.
- **Every write logs to `audit_log`** through one shared helper (`lib/audit.ts`) — reviewers can see who/what/when.
- Secrets stay in `.env.local`; never exposed to the client bundle (only `NEXT_PUBLIC_*` are public).

## 5. UX conventions

- Mobile-first, RTL, Arabic labels; bottom nav on mobile, sidebar on desktop (existing skeleton).
- Every document (expense/invoice/claim/payment) supports **camera + file attachments**.
- Approval queues are first-class screens (custodies, invoices, claims pending approval).
- Notifications bell + Web Push for "waiting for approval" and "payment received" events.
- Dates show Gregorian; amounts formatted with thousands separators + EGP.

## 6. Code layout

```
app/(app)/<domain>/page.tsx          # list screen (TanStack Table)
app/(app)/<domain>/actions.ts        # server actions (mutations, audited)
app/(app)/<domain>/_components/*     # screen-specific UI
components/modals/*                  # add/edit modals
components/ui/*                      # shared primitives + data-grid wrapper
lib/supabase/*  lib/r2.ts  lib/audit.ts  lib/validators/*  lib/money.ts
supabase/migrations/*                # append-only
```

## 7. Definition of Done (every phase)
- Migrations apply cleanly; `npx tsc --noEmit` passes; `next build` passes.
- New tables have RLS + indexes per `01_DATA_MODEL.md`.
- All new writes go through the audit helper.
- List screens use the virtualized data grid and server-side paging where the set can grow.
- Acceptance criteria in the phase file are demonstrably met (with the stated test data).
