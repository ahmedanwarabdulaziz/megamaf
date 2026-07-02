import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/supabase/get-profile'

/**
 * Server-side access guard — call at the top of any page that is gated.
 *
 * If the current user is a super-admin, they always pass.
 * Otherwise, they must have an entry in employee_page_access for `slug`.
 * On failure → redirect('/') which the layout will render gracefully.
 *
 * Also handles:
 *  - Unauthenticated users → redirect('/login')
 *  - Inactive employees    → redirect('/login')
 *
 * Usage:
 *   const { profile } = await requirePageAccess('banks')
 */
export async function requirePageAccess(slug: string) {
  const { user, profile } = await getProfile()

  if (!user) redirect('/login')
  if (!profile) redirect('/login')
  if (profile.is_active === false) redirect('/login')

  const isSuperAdmin = !!profile.is_super_admin
  if (isSuperAdmin) return { user, profile, isSuperAdmin }

  const granted = (profile.employee_page_access as any[])?.map((p: any) => p.page_slug) ?? []

  if (!granted.includes(slug)) {
    // Redirect to home with an error flag the layout can pick up
    redirect('/?access_denied=1')
  }

  return { user, profile, isSuperAdmin }
}
