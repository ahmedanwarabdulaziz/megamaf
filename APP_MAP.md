# MegaMaf — App Map

> **What this file is:** A single, up-to-date picture of the *whole* app — every feature area, every database table, and how they connect. Read this when you've lost track of what exists. It reflects the code as actually built.
>
> Stack: **Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, RLS) + Tailwind**. Files in Cloudflare R2. UI is Arabic / RTL. Default currency **EGP**.
> Last mapped: 2026-06-18.

---

## 1. The big idea

Everything belongs to a **Company**. Inside a company you manage **money** (bank accounts, certificates, expenses), **people** (employees), and **custodies**.

Almost every money-out action ends in two places:
1. an **`expenses`** row (what the money was for), and
2. a **`bank_transactions`** withdrawal (where the money left from).

That pairing is the backbone of the whole system.

---

## 2. Feature areas (what the user sees)

The app has sections in the navigation (sidebar on desktop, bottom bar on mobile). Routes live under `app/(app)/`.

| # | Section (AR) | Route | What it does | Main tables |
|---|---|---|---|---|
| 1 | الرئيسية (Home) | `/` | Dashboard landing. | — |
| 2a | الحسابات البنكية (Bank accounts) | `/accounts` | Banks → bank accounts. Each account has an opening balance; current balance = opening + transactions. Account statement at `/accounts/statement`. | `banks`, `bank_accounts`, `bank_transactions` |
| 2b | الشهادات والودائع (Certificates) | `/finance/certificates` | Investment certificates / deposits. Auto-generates a profit payout schedule; you "collect profit" which records a transaction. | `certificates` |
| 3 | الموظفون (Employees) | `/employees` | Employee records + their **login credentials** and **page access** control. Flags: super-admin, can-have-custody, can-approve-custodies. | `employees`, `employee_page_access` |
| 4 | العهد (Custodies / العهدة) | `/custodies` | Money entrusted to an employee. Lifecycle: created → approved → funded (paid). Can attach a file (stored in R2). | `employee_custodies` |
| 5 | المصروفات (Expenses / Payments) | `/payments` | Records advance payments: employee advance or direct. Creates the expense + bank withdrawal, and auto-settles open custodies. | writes `expenses` + `bank_transactions` |

Auth lives separately under `app/(auth)/`: `/login`, `/change-password`, plus logout.

---

## 3. Data model

### Foundation
- **`companies`** — the root. `default_currency` (EGP).
- **`profiles`** — one per auth user; `company_id` + `role` (`admin` / `member` / `employee`). First-ever user becomes admin.

### Money
- **`banks`** → **`bank_accounts`** (opening_balance, currency) → **`bank_transactions`** (deposit / withdrawal, with `reference_type` + `reference_id` pointing back to what caused it).
- **`certificates`** — standalone; profit schedule computed in code (`lib/finance-utils.ts`), collections logged as transactions.

### People
- **`employees`** — can be linked to an auth user (`auth_user_id`, `username`) so an employee can log in with limited access.
  - **`employee_page_access`** — which app sections an employee may see (ignored if `is_super_admin`).

### Spending
- **`expenses`** — the central spending ledger. Links (optional) to `employee`, `custody`, `bank_account`. `payment_type` = custody / employee_advance / direct.
- **`employee_custodies`** — amount entrusted to an employee. Tracks `approved_at/by`, `funded_at`, funding `bank_account_id`, optional file in R2, and `settled_by_expense_id` (the advance that closed it).

> Conventions that hold across (almost) every table: `id uuid`, `company_id`, `created_at` / `updated_at` (trigger-maintained), `created_by`. Money is `numeric(14,2)`. **RLS is on every table** — a user only sees rows for their own company.

---

## 4. How the pieces connect (the logic that matters)

**Custody → money out.** An employee gets a custody → someone approves it → `payCustody(account)` (or a matching employee-advance payment) creates a `expenses` row **and** a `bank_transactions` withdrawal, then marks the custody `funded`.

**Advance payment → auto-settles custodies.** `addAdvancePayment` (Payments page) records the expense + withdrawal. If it's an **employee advance**, it automatically closes that employee's approved-but-unfunded custodies, oldest first (FIFO), linking them via `settled_by_expense_id`.

**Balances are derived, never typed.** A bank account's current balance = opening balance + sum of its transactions. Certificate profit = computed schedule, not stored.

**Reference trail.** Every `bank_transactions` row carries `reference_type` (`custody` / `employee_advance` / …) + `reference_id`, so you can always trace a withdrawal back to its cause.

---

## 5. Roles & access

- **admin** — full access; only role that can delete most records and change company/role settings.
- **member** — read/write within the company, limited deletes.
- **employee** — logs in with a username; sees only the **pages** (`employee_page_access`) granted to them, unless `is_super_admin`. Enforced in `app/(app)/layout.tsx` and reinforced by RLS.

---

## 6. Quick reference — where to find things in code

```text
app/(app)/<area>/page.tsx        → the screen
app/(app)/<area>/actions.ts      → its server actions (writes)
app/(app)/<area>/_components/    → components used only by that screen
components/modals/               → all add/edit modals (shared)
components/ui/                    → shared design system (button, modal, table, FAB…)
lib/supabase/                     → client / server / admin Supabase clients
lib/validators/                   → Zod schemas
lib/finance-utils.ts             → certificate profit schedule logic
lib/r2.ts                         → Cloudflare R2 file storage
supabase/migrations/             → the database, one file per change
```
