# Phase 10 — Required Fixes (do before Phase 11)

Two report screens query columns that **don't exist** on the views, so they fail silently (PostgREST returns an error, the destructured `data` is null, and the UI shows 0 / empty). Fix via a small migration **`0017_phase10_reports.sql`** (to enrich the financial-position view) plus two page edits.

The actual view columns are:
- `v_project_financial_position` → `project_id, name, code, total_income, total_received, total_expenses, total_paid, retention_held, balance` (**no** `node_type`, **no** `net_position`).
- `v_bank_statement` → `… running_balance` (**no** `balance_after`).
- `v_bank_account_balances` → `… current_balance` ✅ (use this for totals).

---

## FIX 1 — 🟠 Dashboard "company net position" card always shows 0
**Where:** `app/(app)/page.tsx` (~line 30-33) — queries `v_project_financial_position.eq('node_type','main_company').single()` and reads `mainProjectData.net_position`. Neither `node_type` nor `net_position` exists on the view → query errors → card renders 0.
**Do:** enrich the view (FIX 4) to expose `node_type`, `is_main`, and a `net_position` alias, **or** change the page to filter the main company another way and read `balance`. Preferred: enrich the view (the project-position report needs `node_type` too).

## FIX 2 — 🟠 `project-position` report renders empty
**Where:** `app/(app)/reports/project-position/page.tsx` (~line 13) — `.order('node_type', …)` on `v_project_financial_position`, which has no `node_type` → query errors → empty report.
**Do:** add `node_type` to the view (FIX 4); the order-by then works (main company first).

## FIX 3 — 🟠 Dashboard "total cash" uses a non-existent column
**Where:** `app/(app)/page.tsx` (~line 58) — selects `balance_after` from `v_bank_statement` (column is `running_balance`), then hand-rolls "latest balance per account". This errors → `totalCash` falls back to **opening balances only**, not current.
**Do:** replace that block with a direct read of `v_bank_account_balances` and sum `current_balance`:
```ts
const { data: balances } = await supabase.from('v_bank_account_balances').select('current_balance');
const totalCash = (balances ?? []).reduce((s, r) => s + Number(r.current_balance), 0);
```
(Drop the `v_bank_statement` query and the manual loop.)

## FIX 4 — 🟠 Enrich `v_project_financial_position` (migration 0017)
Recreate it `WITH (security_invoker = true)`, keeping all current columns and **adding** `p.node_type`, `p.is_main`, and `balance AS net_position` (alias, so existing pages work). This unblocks FIX 1 and FIX 2 without touching the math.

## FIX 5 — 🟡 Subtree rollup (data-model intent)
`v_project_financial_position` is **per-node** only — a project's figures don't include its branches/phases. The data model says a node's position aggregates its subtree. If you want parent rows to roll up children, compute over the `parent_id` tree (recursive). Consider before relying on project totals for multi-level projects.

## FIX 6 — 🟡 Verify report acceptance criteria
Confirm each report page (bank-statement, vendor-account, owner-account, employee-custody, audit-log) uses the **virtualized grid**, supports **date/project filters**, **CSV/print export**, and respects **project scoping** — and that **P&L cash position == Σ bank balances** reconciles. (Spot-check; the column-mismatch class of bug above is the priority.)

---
**After applying:** `npx tsc --noEmit` + `next build` green. Re-test:
- Dashboard "إجمالي النقدية بالبنوك" equals the sum of `v_bank_account_balances.current_balance` (matches the banks page), and "صافي الموقف المالي للشركة" shows the main company's real net (not 0).
- `project-position` report lists all nodes, main company first, with correct income/expense/balance.
- A project-limited user sees only their projects in every report.
