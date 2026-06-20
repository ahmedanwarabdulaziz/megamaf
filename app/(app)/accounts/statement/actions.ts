"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

export async function deleteTransaction(transactionId: string) {
  const supabase = await createClient()
  
  const { data: userCompany } = await supabase.rpc('get_my_company_id').single()
  if (!userCompany) return { error: "لم يتم العثور على شركتك" }

  const { error } = await supabase
    .from("bank_transactions")
    .delete()
    .eq("id", transactionId)
    .eq("company_id", userCompany)

  if (error) {
    console.error("Delete transaction error:", error)
    return { error: "فشل في حذف المعاملة" }
  }

  revalidatePath("/accounts/statement")
  revalidatePath("/accounts")
  revalidatePath("/finance/certificates")
  return { success: true }
}
