# MAF — Build Phases (index)

Build **strictly in order**. Each phase has its own file with goal, prerequisites, tables, pages, business rules, and acceptance criteria. Do not begin a phase until the previous phase's acceptance criteria pass and `tsc`/`build` are green.

| # | Phase | File | Depends on |
|---|---|---|---|
| 1 | Foundation, Auth & Permissions | `phase-1-foundation-auth.md` | skeleton |
| 2 | Org: Projects, Branches, Owners | `phase-2-projects-org.md` | 1 |
| 3 | Central Ledger & Bank Accounts | `phase-3-ledger-banks.md` | 1 |
| 4 | Custody & Expenses (FIFO) | `phase-4-custody-expenses.md` | 2, 3 |
| 5 | Vendors — Invoices & Claims | `phase-5-vendors-invoices-claims.md` | 2, 3 |
| 6 | Owner Claims & Project Income | `phase-6-owner-income.md` | 2, 3, 5 |
| 7 | Treasury, Payments & Allocation | `phase-7-treasury-payments.md` | 4, 5, 6 |
| 8 | Inventory & Warehouses | `phase-8-inventory.md` | 2, 5 |
| 9 | Deposits & Certificates | `phase-9-deposits.md` | 3 |
| 10 | Reports & Dashboards | `phase-10-reports.md` | all above |
| 11 | Notifications, PWA & Audit Viewer | `phase-11-notifications-pwa.md` | 1 (polish last) |

### Why this order
- **1** establishes identity, permissions, audit, attachments — everything else writes through them.
- **2 & 3** are the two foundations (the org tree and the cash ledger). Claims #5/#6 and custody #4 attribute money to projects (2) and post cash to the ledger (3).
- **7 (treasury)** comes after the documents it pays exist (4/5/6).
- **8/9** are self-contained modules layered on the foundations.
- **10** reads the views built across all phases; **11** is cross-cutting polish.

### Per-phase file template
Each `phase-*.md` follows:
1. **Goal** — one paragraph.
2. **Prerequisites** — phases/tables that must exist.
3. **Database** — exact tables/columns/views/migrations to add (ref `01_DATA_MODEL.md`).
4. **Pages & components** — routes, screens, modals.
5. **Business rules** — the precise logic (formulas, limits, state machines).
6. **Acceptance criteria** — concrete, testable checks with sample data.
7. **Guardrails** — perf/security/audit rules that apply here.
