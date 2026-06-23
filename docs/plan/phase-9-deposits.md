# Phase 9 — Deposits & Certificates

## Goal
Track bank deposits/certificates: define the deposit, auto-generate an expected payout schedule, and "collect" each payout (actual amount) into a chosen bank account — posting to the ledger.

## Prerequisites
Phase 3 (ledger + bank accounts).

## Database
- `deposits`, `deposit_payouts` (`§4`). `bank_name` is **free text** (not linked to `banks`).
- On create, generate `deposit_payouts` rows from term + payout_frequency + profit settings (expected amounts; flagged approximate).

## Pages & components
- `(app)/deposits` — list + create: name, bank_name (free text), description, notes, start_date, term, profit_type (fixed total vs annual rate), profit_value, payout_frequency, principal, default target account.
- Deposit detail — payout schedule grid (seq, due_date, expected_amount, collected?, collected_amount, collected_date, account).
- Collect modal — enter actual amount + date + bank account → write `ledger_entries` (`deposit_collection`, in) and mark payout collected.

## Business rules
- **Schedule generation:**
  - `annual_rate`: per-period expected = principal × (annual_rate/periods_per_year). `fixed_total`: total profit spread across periods (or paid `at_maturity`).
  - Frequencies: monthly/quarterly/semiannual/annual/at_maturity define period count and due_dates from start_date over term_months.
- Expected amounts are indicative; collection records the **actual** received amount (may differ) and which account it landed in.
- Collecting posts to the ledger so the target bank balance/statement updates.

## Acceptance criteria
- Create an annual-rate deposit (e.g. 100,000 @ 12%, monthly, 12 months) → 12 payout rows ≈ 1,000 each with correct due dates.
- Collect one payout with a different actual amount → schedule shows actual, target account balance rises by the actual.
- `fixed_total` and `at_maturity` variants generate sensible schedules.
- `tsc` + `build` green.

## Guardrails
Collection is the only thing that touches the ledger; audit on create/collect; data grid for schedule.
