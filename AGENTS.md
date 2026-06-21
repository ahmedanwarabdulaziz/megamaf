<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:performance-rules -->
# Performance Rules — MegaMaf (Updated June 2026)

These rules were established after a real performance audit revealed slow button/navigation rendering.
Every agent writing code for this project MUST follow these rules.

---

## 1. Never Repeat DB Calls — Use `React.cache()` for Shared Server Fetches

**Rule:** Any data fetched in the layout that is ALSO needed in a page (user, profile, employee) MUST use `React.cache()` so it is deduplicated per-request.

**The helpers are in:** `lib/supabase/get-profile.ts`

```ts
// ✅ CORRECT — calls getProfile() in both layout and page; only ONE DB round-trip total
import { getProfile } from "@/lib/supabase/get-profile"
const { user, profile, supabase } = await getProfile()

// ❌ WRONG — creates a new Supabase client and re-queries auth + profiles on every call
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
const { data: profile } = await supabase.from("profiles").select("*")...
```

**Available cached helpers:**
- `getProfile()` → `{ user, profile, supabase }` — user auth + profiles row + company name
- `getEmployeePermissions(userId)` → employee record with permissions — for role checks in `employee` accounts

---

## 2. Never Put Sequential DB Queries Before Parallel Ones

**Rule:** Where multiple independent DB queries are needed, ALWAYS use `Promise.all([...])`. Never `await` one before starting another if they don't depend on each other.

```ts
// ✅ CORRECT — all queries run simultaneously
const [{ data: employees }, { data: projects }, { data: accounts }] = await Promise.all([
  supabase.from("employees").select("*"),
  supabase.from("projects").select("*"),
  supabase.from("bank_accounts").select("*"),
])

// ❌ WRONG — sequential waterfall; each waits for the previous (3× the latency)
const { data: employees } = await supabase.from("employees").select("*")
const { data: projects } = await supabase.from("projects").select("*")
const { data: accounts } = await supabase.from("bank_accounts").select("*")
```

---

## 3. Never Re-Generate R2 Signed URLs on Every Page Load

**Rule:** R2 signed URL generation requires an outbound network call to Cloudflare. Always use `getCachedSignedUrl()` or `getBatchSignedUrls()` from `lib/r2.ts`. These cache results for 55 minutes (within the 1-hour URL expiry).

```ts
// ✅ CORRECT — cached, no outbound call on repeated visits
import { getBatchSignedUrls } from "@/lib/r2"
const signedUrls = await getBatchSignedUrls(filePaths)

// ❌ WRONG — outbound call to R2 on every single page load for every file
const r2 = createR2Client()
const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket, Key: path }), { expiresIn: 3600 })
```

**Exception:** In Server Actions (upload/delete mutations), it is OK to call `createR2Client()` directly since actions are triggered explicitly by the user, not on every render.

---

## 4. Always Wrap `useSearchParams()` Components in `<Suspense>`

**Rule:** Any component that calls `useSearchParams()` (e.g. `Modal`, `QuickActions`) must be wrapped in `<React.Suspense>`. Without this, Next.js defers the entire surrounding render, which blocks button and nav visibility.

```tsx
// ✅ CORRECT — Modal and QuickActions are in their own Suspense boundaries
<React.Suspense fallback={null}>
  <Modal name="..." title="...">...</Modal>
</React.Suspense>

// ❌ WRONG — useSearchParams() in an unwrapped component delays the whole page paint
<Modal name="..." title="...">...</Modal>
```

**Components in this project that call `useSearchParams()`:**
- `components/ui/modal.tsx`
- `components/ui/quick-actions.tsx`

If you add NEW components that call `useSearchParams()`, wrap them in `<React.Suspense>` too.

---

## 5. Use `<Link>` for Navigation — Never `router.push()` for Static Routes

**Rule:** Always use Next.js `<Link href="...">` for navigation links. `router.push()` does NOT prefetch — the page fetch only starts at click time. `<Link>` prefetches in the background, making navigation feel instant.

```tsx
// ✅ CORRECT — Next.js prefetches /custodies in the background when Link is visible
<Link href="/custodies" className="...">العهد</Link>

// ❌ WRONG — fetch starts only when the user taps; no background prefetch
<button onClick={() => router.push("/custodies")}>العهد</button>
```

**Exception:** Use `router.push()` ONLY when navigation is conditional or dynamic (e.g., after a form submit, after an async action, or when the target URL is computed at runtime). Navigation menu items are always `<Link>`.

---

## 6. The Layout is a Server Component — Don't Over-Fetch in It

**Rule:** `app/(app)/layout.tsx` runs on every navigation. Minimize what it fetches. It should only fetch:
1. User + profile (via `getProfile()`) — needed for sidebar display
2. Employee page permissions (via `getEmployeePermissions()`) — needed for nav filtering

Any page-specific data (custodies list, projects list, etc.) must be fetched in the page component, NOT the layout.

---

## 7. `getUser()` in Server Actions is Correct — Don't Remove It

**Rule:** `supabase.auth.getUser()` calls in `actions.ts` files are intentional and should NOT be replaced with `getProfile()`. Server Actions are mutations — they must independently verify the authenticated user on every call for security.

```ts
// ✅ CORRECT — always re-verify auth in Server Actions
export async function addCustody(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  ...
}
```

---

## Summary Checklist

Before submitting any server-side code, verify:

- [ ] Shared user/profile data uses `getProfile()` from `lib/supabase/get-profile.ts`
- [ ] Multiple independent DB queries use `Promise.all()`
- [ ] R2 signed URLs use `getBatchSignedUrls()` or `getCachedSignedUrl()` from `lib/r2.ts`
- [ ] Any component with `useSearchParams()` is inside `<React.Suspense>`
- [ ] Navigation links use `<Link>`, not `<button onClick={() => router.push(...)}>` 
- [ ] Layout only fetches profile/permission data, not page-specific data
<!-- END:performance-rules -->
