# Phase 11 — Notifications, PWA & Audit Viewer

## Goal
Cross-cutting polish: in-app + push notifications for key events, a fully installable PWA with biometric login on iOS/Android, and an audit-log viewer for owners.

## Prerequisites
Phase 1 (audit/auth). Best done after the modules so notification triggers exist.

## Database
- `notifications`, `push_subscriptions` (`§9`).

## Pages & components
- Notification bell + list (mark read), per-user.
- Web Push: service worker, subscription on permission grant, server send on events.
- PWA: manifest (name, icons, RTL, theme), offline app shell, "Add to Home Screen" prompt (existing `pwa-install-prompt`), iOS install guidance (push needs home-screen install, iOS 16.4+).
- Audit-log viewer (`(app)/settings/audit` or `/reports/audit`): filter by user/entity/date; read-only.

## Notification triggers
- Custody/invoice/claim **submitted → notify approvers** ("waiting for approval").
- Document **approved/rejected → notify submitter**.
- **Payment received** (owner) / **paid** (vendor) → notify relevant users.
- Upcoming owner installment / deposit payout due (scheduled check).

## Business rules
- Notifications respect permissions (only approvers get approval prompts; users see their own).
- Push is best-effort; in-app notifications are the source of truth.
- Single-session rule still applies; a logout clears that device's push subscription.

## Acceptance criteria
- Submitting a custody notifies approvers in-app and via push (where subscribed).
- App installs to home screen on Android + iOS and logs in via biometrics.
- Audit viewer shows accurate before/after for a sample of edits.
- `tsc` + `build` green; Lighthouse PWA installable.

## Guardrails
No secrets in the service worker; audit viewer read-only; push payloads carry no sensitive data (IDs only, fetch on open).
