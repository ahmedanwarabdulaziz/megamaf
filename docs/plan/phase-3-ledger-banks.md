# Phase 3 — Central Ledger & Bank Accounts

## Goal
Create the **single cash source of truth** (`ledger_entries`) and the banking layer on top of it: banks, accounts, opening balances, an accurate statement per account, and manual interest/deduction adjustments to reconcile with the real bank. Also bank-to-bank and bank-to-project transfers.

## Prerequisites
Phases 1, 2.

## Database
- `ledger_entries` (`§3`) with the composite indexes listed in `01_DATA_MODEL.md`.
- `banks`, `bank_accounts` (`§4`). On creating an account with an opening balance → write one `ledger_entries` row `category='opening_balance'`.
- Views: `v_bank_account_balances` (opening + Σin − Σout per account) and `v_bank_statement` (ordered running balance).
- `lib/money.ts` for formatting; all aggregation in SQL/views.

## Pages & components
- `(app)/banks` — banks + accounts list (data grid); add bank, add account (with opening balance, currency=EGP).
- `(app)/banks/[accountId]/statement` — virtualized statement with running balance, date filter, server-side paging.
- Adjustment modal — add interest (in) / deduction (out) row to reconcile.
- Transfer modal — bank→bank or bank→project (creates paired `transfer_out`/`transfer_in`).

## Business rules
- **No balance is computed in JS by summing tables** — always read the view.
- Every money movement in the whole app (this and later phases) inserts a `ledger_entries` row; nothing mutates balances directly.
- Opening balance is itself a ledger row so the statement starts correctly.
- Transfers must net to zero across the two paired rows.

## Acceptance criteria
- Create a bank with two accounts and opening balances; `v_bank_account_balances` matches.
- Post an interest (+) and a deduction (−); statement running balance is correct and ordered.
- Transfer between two accounts; both balances move correctly and net change = 0.
- Statement screen scrolls smoothly with 5,000+ seeded rows (virtualized, server-paged).
- `tsc` + `build` green.

## Guardrails
Indexes present; views used for all balances; `Promise.all` for independent loads; audit on every ledger write.
