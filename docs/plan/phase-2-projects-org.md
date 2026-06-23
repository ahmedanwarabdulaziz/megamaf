# Phase 2 — Org: Projects, Branches, Owners

## Goal
Build the organization tree: the fixed **Main Company** node plus projects, each optionally split into branches → phases, each node carrying its own (future) accounts, warehouse, and financial position. Manage project owners.

## Prerequisites
Phase 1.

## Database
- `projects` (`§1`): seed exactly one `node_type='main_company'`, `is_main=true`, non-closable. Self-referencing `parent_id`; `node_type` ladder project→branch→phase.
- `project_owners` (`§1`); `projects.owner_id` → owner (null for main company).
- View stub `v_project_financial_position` (returns zeros until ledger/claims exist; real logic lands in later phases) so report screens can bind early.

## Pages & components
- `(app)/projects` — tree/list (data grid + expandable rows): main company pinned on top, then projects with their branches/phases. Status badge (open/closed).
- Add/edit project modal: name, code, node_type, parent (for branch/phase), owner, status, notes. Guard: main company cannot be closed/deleted; code unique.
- `(app)/projects/[id]` — node detail shell with tabs (Overview / Financial position / Warehouse) that later phases fill in.
- Owners managed under project or a small `(app)/settings/owners` list.

## Business rules
- Branch/phase creation requires a valid parent; enforce the 3-level max (project→branch→phase).
- Closing a node is allowed only if it has no open obligations (enforce fully once ledger exists; for now block closing the main company only).
- A node's financial position aggregates over its subtree (children roll up to parent).

## Acceptance criteria
- Main company exists, is pinned, cannot be closed or deleted.
- Create a project with two branches, one branch with two phases; tree renders correctly.
- Assign an owner to a project; owner appears on the project.
- Standard user with access to only one project sees only that subtree.
- `tsc` + `build` green.

## Guardrails
Data grid for the list; RLS scoping by `employee_project_access`; audit on writes.
