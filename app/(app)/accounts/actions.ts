"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { addBankSchema, addBankAccountSchema, editBankSchema, editBankAccountSchema } from "@/lib/validators/banks"

export async function addBank(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = addBankSchema.safeParse(data)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: userCompany, error: companyError } = await supabase.rpc('get_my_company_id').single()
  if (companyError || !userCompany) {
    return { error: "لم يتم العثور على شركتك" }
  }

  const { error } = await supabase
    .from("banks")
    .insert({
      company_id: userCompany,
      name: parsed.data.name,
    })

  if (error) {
    console.error("Add bank error:", error)
    return { error: "فشل في إضافة البنك. حاول مرة أخرى." }
  }

  revalidatePath("/accounts")
  return { success: true }
}

export async function addBankAccount(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = addBankAccountSchema.safeParse(data)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: userCompany, error: companyError } = await supabase.rpc('get_my_company_id').single()
  if (companyError || !userCompany) {
    return { error: "لم يتم العثور على شركتك" }
  }

  const { error } = await supabase
    .from("bank_accounts")
    .insert({
      company_id: userCompany,
      bank_id: parsed.data.bank_id,
      account_name: parsed.data.account_name,
      account_number: parsed.data.account_number,
      currency: parsed.data.currency,
      opening_balance: parsed.data.opening_balance,
    })

  if (error) {
    console.error("Add bank account error:", error)
    return { error: "فشل في إضافة الحساب البنكي. حاول مرة أخرى." }
  }

  revalidatePath("/accounts")
  return { success: true }
}

export async function editBank(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = editBankSchema.safeParse(data)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: userCompany, error: companyError } = await supabase.rpc('get_my_company_id').single()
  if (companyError || !userCompany) {
    return { error: "لم يتم العثور على شركتك" }
  }

  const { error } = await supabase
    .from("banks")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .eq("company_id", userCompany)

  if (error) {
    console.error("Edit bank error:", error)
    return { error: "فشل في تعديل البنك. حاول مرة أخرى." }
  }

  revalidatePath("/accounts")
  return { success: true }
}

export async function editBankAccount(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const data = Object.fromEntries(formData.entries())
  const parsed = editBankAccountSchema.safeParse(data)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: userCompany, error: companyError } = await supabase.rpc('get_my_company_id').single()
  if (companyError || !userCompany) {
    return { error: "لم يتم العثور على شركتك" }
  }

  const { error } = await supabase
    .from("bank_accounts")
    .update({
      bank_id: parsed.data.bank_id,
      account_name: parsed.data.account_name,
      account_number: parsed.data.account_number,
      currency: parsed.data.currency,
      opening_balance: parsed.data.opening_balance,
    })
    .eq("id", parsed.data.id)
    .eq("company_id", userCompany)

  if (error) {
    console.error("Edit bank account error:", error)
    return { error: "فشل في تعديل الحساب البنكي. حاول مرة أخرى." }
  }

  revalidatePath("/accounts")
  return { success: true }
}
