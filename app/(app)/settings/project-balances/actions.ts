"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function saveProjectLegacyBalances(
  projectId: string,
  legacyPaidCustodies: number,
  legacyVendorPayments: number,
  legacyFunds: number
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "غير مصرح" }

  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لم يتم العثور على شركتك" }

  // Upsert the legacy balances
  const { error } = await supabase
    .from("project_legacy_balances")
    .upsert({
      company_id: companyId,
      project_id: projectId,
      legacy_paid_custodies: legacyPaidCustodies,
      legacy_vendor_payments: legacyVendorPayments,
      legacy_funds: legacyFunds,
      updated_at: new Date().toISOString()
    }, { onConflict: "project_id" })

  if (error) {
    return { error: `فشل حفظ الأرصدة الافتتاحية: ${error.message}` }
  }

  revalidatePath("/projects")
  revalidatePath("/settings/project-balances")
  return { success: true }
}
