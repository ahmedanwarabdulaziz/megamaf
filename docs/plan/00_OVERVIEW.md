# MAF — System Overview

> **Audience:** the AI builder (Antigravity) + human supervisors (Ahmed + Claude).
> **Read order:** `00_OVERVIEW` → `01_DATA_MODEL` → `02_CONVENTIONS` → `03_PHASES` → individual `phase-*.md` files **in order**.
> **Golden rule:** do not start a phase until the previous phase's *Acceptance Criteria* all pass. The data model is settled up front — **do not invent new tables or rename columns** without updating `01_DATA_MODEL.md` first.

---

## 1. What MAF is

MAF is a **finance & operations system for a contracting (construction) company**. It tracks every pound in and out across the main company and all its projects, and produces accurate reports on demand.

It must feel like a **native mobile app** (installable PWA, biometric login, camera attachments) while also presenting a **professional desktop layout** for reviewing data. Arabic-only, **RTL**.

The company is named **MAF (ماف)**.

## 2. Who uses it

Two user levels, both stored as **employees**:

1. **Owners / Super Admins** — can do everything, no restrictions.
2. **Standard users** — each user is granted, individually:
   - whether they may use the system at all,
   - which **pages** they can access (access yes/no per page),
   - **can-approve** flag (approve custodies / claims / invoices),
   - which **projects** are visible to them.

**Login:** username + **6-digit PIN** (no email). Primary login is **passkey / biometric** (Face ID / fingerprint) for phones; username+PIN is the fallback. Lockout after repeated wrong PINs. **One active session per user** (logging in on a new device ends the old session).

## 3. The core domains

| Domain | Summary |
|---|---|
| **Org** | Main Company (fixed, non-closable) + Projects. Project → Branches → Phases (phases optional). Each phase has its own accounts view, warehouse, and financial position. |
| **Central Ledger** | One table every money movement posts to. All balances/statements derive from it. |
| **Banks** | Bank → multiple accounts, opening balances, detailed statement, manual interest/deduction adjustments. |
| **Deposits/Certificates** | Free-text bank, term, profit (fixed or annual rate), auto payout schedule, "collect" actual amounts into a bank account. |
| **Owners (project income)** | Each project has an owner. Owner is billed via an **owner claim** (same engine as contractor claims). Expected-payment schedule + actual payments = the project's income. |
| **Custody / Expenses** | Petty-cash via employees: categories/sub-categories, expense entry with photos, manager approval, **FIFO** settlement against custody disbursements, partial settlement. |
| **Vendors** | Vendors/contractors allowed on company / specific / all projects. They bill via **Invoices** and **Progress Claims (مستخلصات)**. |
| **Treasury / Payments** | Approved invoices/claims/owner-claims appear; treasury pays an amount, then **manually allocates** it to specific documents (supports partial & overpayment/credit). |
| **Inventory** | Warehouses per company/project. Items received from vendor invoices, stock-on-hand, transfers (main → project), issues, and owner-claim lines that consume stock. |
| **Reports** | Project financial position, bank statement, employee custody statement, vendor account statement, deposit/profit schedule, audit log, company P&L. |
| **Cross-cutting** | Full audit log (user + timestamp on every write), attachments (camera/file) on every document, push notifications, fast UI with a high-performance data grid. |

## 4. The three problems we are deliberately fixing from the old build

1. **Scattered balances.** Old code summed balances from 5+ places (direct expenses + custodies + PO settlements …). **Fix:** a single `ledger_entries` table is the only source of truth for cash; document tables hold *intent*, the ledger holds *money*. See `01_DATA_MODEL.md` §Ledger.
2. **Schema churn.** Old repo had dozens of "simplify/restore/fix" migrations. **Fix:** the model in `01_DATA_MODEL.md` is settled before building; phases add tables in dependency order, never rework them.
3. **Performance band-aids.** **Fix:** performance + query rules are first-class in `02_CONVENTIONS.md` (cached fetches, parallel queries, indexes, virtualized data grid) and are part of every phase's acceptance criteria.

## 5. Open items to confirm with Ahmed (assumptions used until corrected)

1. **One owner per project** (assumed). If a project can have multiple owners/clients, say so.
2. **Owner claim math = identical to contractor claim** (cumulative qty × price, optional retention %, optional tax). Assumed yes.
3. **Expense recognition timing:** a custody expense becomes a **project cost when approved** (accrual); paying the employee back is a separate cash event. Assumed yes.
4. **Notifications channel:** Web Push (PWA) is the baseline. Native iOS push requires the app be installed to home screen (iOS 16.4+). Assumed acceptable.

These are flagged inside the relevant phase files too.
