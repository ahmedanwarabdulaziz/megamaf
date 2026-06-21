"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function addVendor(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const name = formData.get("name") as string
  const type = formData.get("type") as string || "both"
  const phone = formData.get("phone") as string
  const email = formData.get("email") as string
  const tax_number = formData.get("tax_number") as string
  const project_ids = formData.getAll("project_ids") as string[]

  if (!name) return { error: "الاسم مطلوب" }

  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لا يوجد شركة" }

  const { data: newVendor, error } = await supabase
    .from("vendors")
    .insert({ company_id: companyId, name, type, phone, email, tax_number })
    .select("id")
    .single()

  if (error) return { error: "فشل في إضافة المورد" }

  if (project_ids.length > 0) {
    const accessRows = project_ids.map(pid => ({ vendor_id: newVendor.id, project_id: pid }))
    await supabase.from("vendor_project_access").insert(accessRows)
  }

  revalidatePath("/vendors")
  return { success: true }
}

export async function editVendor(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const id = formData.get("id") as string
  const name = formData.get("name") as string
  const type = formData.get("type") as string || "both"
  const phone = formData.get("phone") as string
  const email = formData.get("email") as string
  const tax_number = formData.get("tax_number") as string
  const project_ids = formData.getAll("project_ids") as string[]

  if (!id || !name) return { error: "الاسم مطلوب" }

  const { error } = await supabase
    .from("vendors")
    .update({ name, type, phone, email, tax_number })
    .eq("id", id)

  if (error) return { error: "فشل في تعديل المورد" }

  // Update project access: delete old, insert new
  await supabase.from("vendor_project_access").delete().eq("vendor_id", id)

  if (project_ids.length > 0) {
    const accessRows = project_ids.map(pid => ({ vendor_id: id, project_id: pid }))
    await supabase.from("vendor_project_access").insert(accessRows)
  }

  revalidatePath("/vendors")
  return { success: true }
}

export async function addVendorPO(prevState: any, formData: FormData) {
  const supabase = await createClient()

  const vendor_id = formData.get("vendor_id") as string
  const project_id = formData.get("project_id") as string
  const amountStr = formData.get("amount") as string
  const description = formData.get("description") as string
  const po_date = formData.get("po_date") as string

  if (!vendor_id || !project_id || !amountStr || !description) return { error: "جميع الحقول المطلوبة يجب تعبئتها" }

  const amount = Number(amountStr)
  if (isNaN(amount) || amount <= 0) return { error: "المبلغ غير صالح" }

  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لا يوجد شركة" }

  const { data: insertedPo, error } = await supabase
    .from("vendor_pos")
    .insert({
      company_id: companyId,
      vendor_id,
      project_id,
      amount,
      description,
      po_date: po_date || new Date().toISOString().split("T")[0]
    })
    .select("id, amount")
    .single()

  if (error || !insertedPo) return { error: "فشل في تسجيل المطالبة" }

  // ── Auto-Settle with Existing Surplus Payments ──────────────────────────
  const { data: surplusPayments } = await supabase
    .from("expenses")
    .select("id, amount, allocated_amount")
    .eq("payment_type", "vendor_payment")
    .eq("vendor_id", vendor_id)
    .eq("company_id", companyId)
    .order("expense_date", { ascending: true })
    .order("created_at", { ascending: true })

  if (surplusPayments && surplusPayments.length > 0) {
    let remainingToPay = amount
    const settlementsToInsert = []

    for (const payment of surplusPayments) {
      const totalAllocated = Number(payment.allocated_amount || 0)
      const totalPaymentAmt = Number(payment.amount || 0)
      const surplus = totalPaymentAmt - totalAllocated

      if (surplus > 0 && remainingToPay > 0) {
        const toPay = Math.min(surplus, remainingToPay)
        settlementsToInsert.push({
          company_id: companyId,
          vendor_po_id: insertedPo.id,
          expense_id: payment.id,
          amount: toPay
        })
        remainingToPay -= toPay
      }

      if (remainingToPay <= 0) break
    }

    if (settlementsToInsert.length > 0) {
      await supabase.from("vendor_po_settlements").insert(settlementsToInsert)
    }
  }

  revalidatePath("/vendors")
  revalidatePath("/vendor-pos")
  revalidatePath("/payments")
  return { success: true }
}

export async function deleteVendor(id: string) {
  const supabase = await createClient()

  // Verify role
  const { data: userProfile } = await supabase.from("profiles").select("role").single()
  if (userProfile?.role !== "admin") {
    throw new Error("Unauthorized")
  }

  const { error } = await supabase.from("vendors").delete().eq("id", id)

  if (error) {
    console.error("Failed to delete vendor", error)
    throw new Error("Failed to delete vendor")
  }

  revalidatePath("/vendors")
}
