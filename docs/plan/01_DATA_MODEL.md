# MAF — Data Model (settled)

> This is the **single source of truth** for the schema. Phases add these tables in dependency order. **Do not** add/rename tables or columns without editing this file first. All tables are Postgres/Supabase, `snake_case`, every table has `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, and (where writable) `updated_at`. Money columns are `numeric(18,2)`. EGP only for v1; a `currency` column defaults to `'EGP'`.

## Core principle — Cash vs Accrual

Two layers, never mixed:

- **Cash truth = `ledger_entries`.** Every actual money movement (bank in/out, custody disbursement, vendor/owner payment, deposit collection, interest/deduction, transfer, opening balance) is one ledger row. **Bank balances and cash statements derive ONLY from here.**
- **Accrual truth = document tables** (`expenses`, `invoices`, `claims`, owner claims). These record what is *owed/billed/cost-recognized* regardless of payment. **Project financial position** combines documents (costs billed, income billed) with the ledger (cash paid/received) and retention.

Never compute a balance by summing several document tables — that was the old bug.

---

## 1. Org & Users

**`projects`** — the org tree (Main Company + projects + branches + phases)
`id, name, code (unique), node_type ('main_company'|'project'|'branch'|'phase'), parent_id (self fk, null for roots), owner_id (fk project_owners, null for main_company), status ('open'|'closed'), is_main (bool), sort_order, notes`
- Exactly one row with `node_type='main_company'`, `is_main=true`, **cannot be closed/deleted**.
- Hierarchy: project → branch → phase (branch/phase optional). A node's financial position = aggregation over its subtree.

**`project_owners`** — clients who own/fund a project
`id, name, phone, notes` (v1 assumption: one owner per project via `projects.owner_id`).

**`employees`** — every user is an employee
`id, full_name, username (unique, citext), pin_hash, role ('owner'|'standard'), is_active (system access bool), is_super_admin (bool), can_approve (bool), phone, auth_user_id (fk auth.users), failed_pin_attempts (int), locked_until (timestamptz), active_session_id (uuid, for single-session)`

**`employee_page_access`** — `employee_id, page_slug` (a row = access granted to that page).
**`employee_project_access`** — `employee_id, project_id` (a row = that project is visible).
**`user_credentials`** — passkeys: `employee_id, credential_id (unique), public_key, counter, transports[], device_label`.
**`user_sessions`** — `employee_id, token_hash, device, ip, last_seen`. Login issues a new session and sets `employees.active_session_id`; any other session is rejected (single active session).

## 2. Audit & Attachments (cross-cutting)

**`audit_log`** — `id, employee_id, action ('create'|'update'|'delete'|'approve'|'login'…), entity_type, entity_id, before (jsonb), after (jsonb), ip, created_at`. **Every write in the app inserts here** (via a shared server helper, not optional).

**`attachments`** — polymorphic: `id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by, created_at`. Used by expenses, invoices, claims, owner claims, payments. Files live in Cloudflare R2; only the key is stored.

## 3. Central Ledger

**`ledger_entries`** — the only cash source of truth
`id, entry_date (date), direction ('in'|'out'), amount, category ('opening_balance'|'bank_in'|'bank_out'|'custody_disbursement'|'vendor_payment'|'owner_payment'|'deposit_collection'|'interest'|'deduction'|'transfer_in'|'transfer_out'), bank_account_id (fk, nullable), project_id (fk, nullable — which node the money is attributed to), employee_id (fk, nullable — for custody cash held by an employee), counterparty_type ('vendor'|'owner'|'employee'|'bank'|'internal'|null), counterparty_id (uuid, nullable), source_type (originating doc table, nullable), source_id (uuid, nullable), memo, created_by`
- **Bank account balance** = its `opening_balance` + Σ(in) − Σ(out) over rows with that `bank_account_id`.
- **Employee custody cash balance** = Σ(custody_disbursement in to employee) − Σ(settled approved expenses). (see §5)
- Transfers create a paired `transfer_out` + `transfer_in`.

## 4. Banks & Deposits

**`banks`** — `id, name`.
**`bank_accounts`** — `id, bank_id, account_name, account_number, opening_balance, currency default 'EGP'`. Statement = opening_balance + `ledger_entries` for the account, ordered by date. Manual reconciliation = ledger rows with category `interest` / `deduction`.

**`deposits`** — `id, name, bank_name (free text, NOT fk), description, notes, start_date, term_months, profit_type ('fixed_total'|'annual_rate'), profit_value, payout_frequency ('monthly'|'quarterly'|'semiannual'|'annual'|'at_maturity'), principal_amount, default_bank_account_id (nullable)`.
**`deposit_payouts`** — generated on create: `id, deposit_id, seq, due_date, expected_amount, is_collected (bool), collected_amount, collected_date, bank_account_id (where deposited), ledger_entry_id`. "Collect" → write the actual amount + create a `ledger_entries` row (`deposit_collection`, in).

## 5. Custody / Expenses

**`expense_categories`** — `id, name, parent_id (self fk, null = top-level), is_active`. Two levels: category + sub-category.

**`expenses`** — petty-cash expense logged by an employee
`id, project_id, employee_id, category_id, expense_date, amount, notes, status ('pending'|'approved'|'rejected'), approved_by, approved_at, settled_amount (derived/maintained)`
- Employee may set `expense_date` = today … up to **15 days back**; admins unrestricted (enforced server-side).
- Attachments via `attachments`.
- On **approve**: recognized as a project cost; becomes eligible for FIFO settlement.

**Custody disbursement** = a `ledger_entries` row, category `custody_disbursement`, direction `in`, `employee_id` set (cash handed to the employee, paid out of a bank account → also a bank `out` … model as a transfer pair or as one row attributed to both; see phase-4 for the exact mechanic).

**`custody_settlements`** — FIFO links between disbursements and approved expenses
`id, employee_id, expense_id, disbursement_ledger_id, amount`.
- When a disbursement is recorded, auto-allocate it to the employee's **oldest unsettled approved expenses first (FIFO)**. Partial allowed: an expense can be settled across multiple rows; `expenses.settled_amount = Σ allocations`. Employee custody balance = Σ disbursements − Σ approved-expense settlements (can be negative = company owes employee / employee overspent).

## 6. Vendors — Invoices & Claims

**`vendors`** — `id, name, kind ('vendor'|'contractor'), phone, notes, all_projects (bool)`.
**`vendor_project_access`** — `vendor_id, project_id` (only when `all_projects=false`).

**`invoices`** — `id, vendor_id, project_id, invoice_date, tax_enabled (bool), tax_rate, discount_rate, subtotal, discount_amount, tax_amount, total, status ('pending'|'approved'|'rejected'), approved_by, approved_at, notes`.
**`invoice_items`** — `id, invoice_id, description, qty, unit_price, line_total, warehouse_id (nullable — if received into stock)`.
- `subtotal = Σ line_total`; `discount_amount = subtotal*discount_rate`; `tax_amount = (subtotal−discount_amount)*tax_rate` (only if `tax_enabled`); `total = subtotal − discount_amount + tax_amount`.

**`claims`** — unified progress claims (مستخلصات) for **both** contractors and owners
`id, claim_type ('vendor'|'owner'), party_id (vendor_id OR project_owners.id), project_id, claim_number (sequential per party+project), claim_date, tax_enabled (bool), tax_rate, status ('pending'|'approved'|'rejected'), approved_by, approved_at, notes`
**`claim_items`** — `id, claim_id, item_ref (stable id of the work item across claims), description, previous_qty, current_qty, unit_price (fixed from first appearance), disbursement_pct, line_total, is_stock_issue (bool, owner claims only), warehouse_id (nullable)`.

### Claim math (exact)
For each `item_ref` within a claim:
- `cumulative_qty = previous_qty + current_qty` (previous_qty = Σ current_qty of same item_ref in prior approved claims).
- `line_total = cumulative_qty * unit_price`  → e.g. (100+50)×10 = **1500**.
- `cumulative_payable = line_total * disbursement_pct` (e.g. 90%).
- `cumulative_retained = line_total * (1 − disbursement_pct)`.

Per claim (sum over items), plus tax if enabled on the net:
- `total_due_this_claim = Σ cumulative_payable(this) − Σ cumulative_payable(prior claim)`.
- `total_retained_to_date = Σ cumulative_retained`.
- `total_paid` = Σ allocated payments to this party/project (from ledger allocations).
- `total_remaining = (Σ cumulative_payable to date) − total_paid − retention_released_paid`.

**Retention release** — admin may release retention anytime and may change `disbursement_pct` on later claims (deal can change mid-way):
**`retention_releases`** — `id, claim_type, party_id, project_id, amount, released_by, released_at, notes`. A release becomes a payable settled via a normal treasury payment.

## 7. Treasury / Payments & Allocation

A payment/receipt is a `ledger_entries` row (`vendor_payment`/`owner_payment`, out/in, bank_account_id set, counterparty set). The amount is then **manually allocated**:

**`payment_allocations`** — `id, ledger_entry_id, target_type ('invoice'|'claim'|'retention_release'|'owner_claim'|'owner_schedule'), target_id, amount`.
- Supports partial (allocate < document total) and overpayment (sum of allocations < payment → remainder = party **credit** that can be allocated later).
- Custody uses `custody_settlements` (FIFO) instead; vendors/owners use manual `payment_allocations`.
- Vendor/owner **account statement** = their documents (invoices/claims/releases) vs their ledger payments+allocations.

**`owner_payment_schedule`** — expected installments from an owner: `id, project_id, owner_id, seq, due_date, expected_amount, method, status ('expected'|'partial'|'paid')`. Actual receipts come via treasury (ledger `owner_payment` in) allocated to schedule rows and/or owner claims.

## 8. Inventory

**`warehouses`** — `id, project_id (the owning node; main company allowed), name`.
**`inventory_items`** — catalog: `id, name, unit (e.g. piece/kg/m), notes`.
**`stock_movements`** — `id, warehouse_id, item_id, movement_type ('in_invoice'|'transfer_out'|'transfer_in'|'issue'|'adjust'), qty, unit_price, related_warehouse_id (for transfers), source_type, source_id, created_by`.
- Stock-on-hand(warehouse,item) = Σ in-type − Σ out-type.
- Vendor invoice item with `warehouse_id` → `in_invoice` movement. Main→project transfer = paired `transfer_out`/`transfer_in`. Owner claim line with `is_stock_issue` → `issue` movement out of `warehouse_id`.

## 9. Settings & Notifications

**`app_settings`** — `key (unique), value (jsonb)`: currencies list, default tax rate, default retention %, PIN/lockout policy, etc.
**`notifications`** — `id, employee_id, type, title, body, entity_type, entity_id, is_read (bool)`.
**`push_subscriptions`** — `id, employee_id, endpoint, p256dh, auth` (Web Push keys).

---

## Index strategy (baked in, not later)
- FK columns indexed. `ledger_entries`: composite indexes on `(bank_account_id, entry_date)`, `(project_id, entry_date)`, `(employee_id)`, `(counterparty_type, counterparty_id)`.
- `expenses (employee_id, status, expense_date)`, `claim_items (claim_id)`, `(item_ref)`, `stock_movements (warehouse_id, item_id)`, `audit_log (entity_type, entity_id)`, `attachments (entity_type, entity_id)`.
- RLS on every table; access filtered by `employee_project_access` and page permissions (super admins bypass).
