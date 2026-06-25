import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

/**
 * Memoized user + profile fetch using React.cache().
 *
 * React.cache() deduplicates calls within the same request lifecycle,
 * meaning if layout.tsx AND a page both call getProfile(), only ONE
 * Supabase round-trip is made per request. This eliminates the repeated
 * auth.getUser() + profiles query on every navigation.
 *
 * IMPORTANT: This is only deduplicated per-request (per server render).
 * It does NOT persist across requests — it's pure request-level memoization.
 */
export const getProfile = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { user: null, profile: null, supabase }

  const { data: profile } = await supabase
    .from("employees")
    .select("*")
    .eq("auth_user_id", user.id)
    .single()

  return { user, profile, supabase }
})

export const getEmployeePermissions = cache(async (userId: string) => {
  const supabase = await createClient()
  const { data: employee } = await supabase
    .from("employees")
    .select("id, is_super_admin, can_approve, employee_page_access(page_slug)")
    .eq("auth_user_id", userId)
    .single()
  return employee
})
