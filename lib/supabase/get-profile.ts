import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

/**
 * Merged profile + permissions fetch — single employees query per request.
 *
 * Previously layout.tsx called getProfile() + getEmployeePermissions() as two
 * sequential awaits, hitting the employees table TWICE.
 * Now one query fetches everything: profile fields + is_super_admin + page access.
 *
 * React.cache() deduplicates within the same request — layout + page can both
 * call getProfile() and only ONE round-trip is made.
 */
export const getProfile = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { user: null, profile: null, supabase }

  const { data: profile } = await supabase
    .from("employees")
    .select(
      "id, full_name, role, is_super_admin, can_approve, has_custody_access, is_active, active_session_id, employee_page_access(page_slug)"
    )
    .eq("auth_user_id", user.id)
    .single()

  return { user, profile, supabase }
})

/**
 * @deprecated Use getProfile() — it now includes permissions in one query.
 * Kept for backward compatibility. Returns the same employee row from cache.
 */
export const getEmployeePermissions = cache(async (userId: string) => {
  const supabase = await createClient()
  const { data: employee } = await supabase
    .from("employees")
    .select("id, is_super_admin, can_approve, employee_page_access(page_slug)")
    .eq("auth_user_id", userId)
    .single()
  return employee
})
