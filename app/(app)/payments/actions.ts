"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export type AddPaymentInput = {
  payment_type: "employee_advance" | "direct"
  employee_id?: string
  bank_account_id: string
  description: string
  amount: number
  payment_date: string
  notes?: string
}

export async function addAdvancePayment(input: AddPaymentInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "غير مصرح" }

  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لم يتم العثور على شركتك" }

  // Validate required fields
  if (!input.bank_account_id) return { error: "يجب اختيار حساب بنكي" }
  if (!input.description?.trim()) return { error: "يجب إدخال وصف للدفعة" }
  if (!input.amount || input.amount <= 0) return { error: "يجب إدخال مبلغ صحيح" }
  if (!input.payment_date) return { error: "يجب تحديد تاريخ الدفع" }
  if (input.payment_type === "employee_advance" && !input.employee_id)
    return { error: "يجب اختيار الموظف" }

  // 1. Create the expense record
  const { data: expense, error: expenseErr } = await supabase
    .from("expenses")
    .insert({
      company_id: companyId,
      employee_id: input.employee_id || null,
      bank_account_id: input.bank_account_id,
      payment_type: input.payment_type,
      description: input.description.trim(),
      amount: input.amount,
      expense_date: input.payment_date,
      notes: input.notes?.trim() || null,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (expenseErr || !expense) return { error: `فشل إنشاء سجل الدفعة: ${expenseErr?.message}` }

  // 2. Create the bank withdrawal transaction
  const typeLabel =
    input.payment_type === "employee_advance" ? "سلفة موظف" : "دفعة مباشرة"

  const { error: txErr } = await supabase
    .from("bank_transactions")
    .insert({
      company_id: companyId,
      bank_account_id: input.bank_account_id,
      type: "withdrawal",
      amount: input.amount,
      transaction_date: input.payment_date,
      description: `${typeLabel}: ${input.description.trim()}`,
      reference_type: input.payment_type,
      reference_id: expense.id,
    })

  if (txErr) {
    // Rollback expense
    await supabase.from("expenses").delete().eq("id", expense.id)
    return { error: `فشل تسجيل المعاملة البنكية: ${txErr.message}` }
  }

  revalidatePath("/payments")

  // ── Auto-settle approved custodies for employee advances ──────────────────
  if (input.payment_type === "employee_advance" && input.employee_id) {
    const { data: openCustodies } = await supabase
      .from("employee_custodies")
      .select("id, amount")
      .eq("employee_id", input.employee_id)
      .eq("company_id", companyId)
      .not("approved_at", "is", null)
      .is("funded_at", null)
      .order("date", { ascending: true }) // FIFO — oldest first

    if (openCustodies && openCustodies.length > 0) {
      const now = new Date().toISOString()
      await supabase
        .from("employee_custodies")
        .update({
          funded_at: now,
          bank_account_id: input.bank_account_id,
          settled_by_expense_id: expense.id, // link back to the advance payment
        })
        .in("id", openCustodies.map(c => c.id))
      revalidatePath("/custodies")
    }
  }

  return { success: true }
}
