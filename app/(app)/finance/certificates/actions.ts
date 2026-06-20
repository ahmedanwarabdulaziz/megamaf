"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { addCertificateSchema, collectProfitSchema, editCertificateSchema } from "@/lib/validators/finance"

export async function addCertificate(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = addCertificateSchema.safeParse(data)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: userCompany, error: companyError } = await supabase.rpc('get_my_company_id').single()
  if (companyError || !userCompany) {
    return { error: "لم يتم العثور على شركتك" }
  }

  const { error } = await supabase
    .from("certificates")
    .insert({
      company_id: userCompany,
      bank_name: parsed.data.bank_name,
      certificate_type: parsed.data.certificate_type,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      start_date: parsed.data.start_date,
      duration_months: parsed.data.duration_months,
      interest_rate: parsed.data.interest_rate,
      payout_frequency: parsed.data.payout_frequency,
      notes: parsed.data.notes,
    })

  if (error) {
    console.error("Add certificate error:", error)
    return { error: "فشل في إضافة الشهادة/الوديعة. حاول مرة أخرى." }
  }

  revalidatePath("/finance/certificates")
  return { success: true }
}

export async function editCertificate(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = editCertificateSchema.safeParse(data)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: userCompany, error: companyError } = await supabase.rpc('get_my_company_id').single()
  if (companyError || !userCompany) {
    return { error: "لم يتم العثور على شركتك" }
  }

  const { error } = await supabase
    .from("certificates")
    .update({
      bank_name: parsed.data.bank_name,
      certificate_type: parsed.data.certificate_type,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      start_date: parsed.data.start_date,
      duration_months: parsed.data.duration_months,
      interest_rate: parsed.data.interest_rate,
      payout_frequency: parsed.data.payout_frequency,
      notes: parsed.data.notes,
    })
    .eq("id", parsed.data.id)
    .eq("company_id", userCompany)

  if (error) {
    console.error("Edit certificate error:", error)
    return { error: "فشل في تعديل الشهادة/الوديعة. حاول مرة أخرى." }
  }

  revalidatePath("/finance/certificates")
  return { success: true }
}

export async function collectProfit(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = collectProfitSchema.safeParse(data)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: userCompany, error: companyError } = await supabase.rpc('get_my_company_id').single()
  if (companyError || !userCompany) {
    return { error: "لم يتم العثور على شركتك" }
  }

  const { error } = await supabase
    .from("bank_transactions")
    .insert({
      company_id: userCompany,
      bank_account_id: parsed.data.bank_account_id,
      type: 'deposit',
      amount: parsed.data.amount,
      transaction_date: parsed.data.transaction_date,
      description: parsed.data.description || "أرباح شهادة بنكية",
      reference_type: 'certificate_profit',
      reference_id: parsed.data.certificate_id,
    })

  if (error) {
    console.error("Collect profit error:", error)
    return { error: "فشل في تسجيل المعاملة. حاول مرة أخرى." }
  }

  revalidatePath("/finance/certificates")
  revalidatePath("/accounts")
  return { success: true }
}
