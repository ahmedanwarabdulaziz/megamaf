# Phase 1 — Foundation, Auth & Permissions

## Goal
Stand up identity, permissions, audit, and attachments — the spine every other phase writes through. After this phase, an owner can log in with passkey or username+PIN, create employees, and grant each employee system access, page access, project access, and the can-approve flag. Every write is audited.

## Prerequisites
The current clean skeleton (auth routes, `lib/supabase/*`, `lib/r2.ts`, `components/ui/*`).

## Database (migrations, append-only)
- `employees`, `employee_page_access`, `employee_project_access`, `user_credentials`, `user_sessions` (see `01_DATA_MODEL.md §1`).
- `audit_log`, `attachments` (`§2`).
- `app_settings` (`§9`) seeded with PIN/lockout policy + currencies = `['EGP']`.
- Seed: one `employees` row = the first **owner** (super admin).
- RLS on all; super admin bypass; standard users limited by their access tables.
- Helpers: `lib/audit.ts` (single write→audit helper), `lib/auth/pin.ts` (bcrypt + lockout), `lib/auth/passkey.ts` (WebAuthn register/verify), `lib/auth/session.ts` (single active session).

## Pages & components
- `(auth)/login` — username + 6-digit PIN entry **and** "Sign in with biometrics" (passkey). Lockout messaging.
- `(app)/employees` — list (data grid), add/edit employee modal: full name, username, set/reset PIN, role (owner/standard), is_active, can_approve.
- Employee detail / `set-page-access` modal — toggles per page slug; `employee_project_access` multi-select of projects; passkey enrollment ("register this device").
- `(app)/settings` shell with a Currencies sub-section (read-only list + add, future-proofing).
- Audit log viewer is built in Phase 11; here just ensure rows are written.

## Business rules
- **Login:** passkey primary; username+PIN fallback. PIN verified server-side (bcrypt). After 5 wrong PINs → `locked_until = now()+15min`. Successful login rotates `active_session_id`; middleware rejects stale sessions (single device).
- **Permission model:** super admin = everything. Standard user: can open a page only if a `employee_page_access` row exists; sees only projects in `employee_project_access`; may approve only if `can_approve`.
- **Server actions** check permission server-side; never trust the client. **All writes** call `lib/audit.ts`.

## Acceptance criteria
- Create an owner and a standard user; standard user sees only granted pages/projects.
- Register a passkey on a device and log in with it; also log in with username+PIN.
- 5 wrong PINs locks the account for 15 min.
- Logging in on device B ends device A's session.
- Creating/editing an employee writes an `audit_log` row with before/after.
- `tsc` + `build` green; RLS verified (standard user cannot read other projects' rows).

## Guardrails
`React.cache()` for profile/permissions; RLS on every table; secrets server-only; audit on every write.
