"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export type AddPaymentInput = {
  payment_type: "employee_advance" | "direct" | "vendor_payment"
  employee_id?: string
  vendor_id?: string
  bank_account_id: string
  description: string
  amount: number
  payment_date: string
  notes?: string
}

// ─── Helper: fetch pending custodies for an employee ─────────────────────────

export async function getEmployeePendingCustodies(employeeId: string) {
  if (!employeeId) return { data: [], total: 0 }
  const supabase = await createClient()
  const { data } = await supabase
    .from("employee_custodies")
    .select("id, item, amount, date, approved_at, notes")
    .eq("employee_id", employeeId)
    .not("approved_at", "is", null)
    .is("funded_at", null)
    .order("date", { ascending: true })

  const list = data || []
  const total = list.reduce((s, c) => s + Number(c.amount), 0)
  return { data: list, total }
}

// ─── Add Advance Payment ──────────────────────────────────────────────────────

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
  if (input.payment_type === "vendor_payment" && !input.vendor_id)
    return { error: "يجب اختيار المورد" }

  // 1. Create the expense record
  const { data: expense, error: expenseErr } = await supabase
    .from("expenses")
    .insert({
      company_id: companyId,
      employee_id: input.employee_id || null,
      vendor_id: input.vendor_id || null,
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
    input.payment_type === "employee_advance" ? "سلفة موظف" :
    input.payment_type === "vendor_payment" ? "دفعة مورد" : "دفعة مباشرة"

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

  // ── Smart FIFO Partial Settlement of Approved Custodies ────────────────────
  if (input.payment_type === "employee_advance" && input.employee_id) {
    // Note: To find "unfunded" or "partially funded" custodies, we check if funded_amount < amount
    // Wait, since we are doing this in JS, we need to fetch all where funded_amount < amount
    // But supabase `lt` requires comparing two columns or one column to value. We can't do `.lt("funded_amount", "amount")` easily with PostgREST without an RPC or raw SQL view.
    // Instead, we just fetch all approved custodies for this employee, and filter in memory, or use a view.
    // Actually, we can fetch all open ones:
    const { data: openCustodies } = await supabase
      .from("employee_custodies")
      .select("id, amount, funded_amount")
      .eq("employee_id", input.employee_id)
      .eq("company_id", companyId)
      .not("approved_at", "is", null)
      .order("date", { ascending: true }) // FIFO — oldest first
      .order("created_at", { ascending: true })

    if (openCustodies && openCustodies.length > 0) {
      let remaining = input.amount
      const settlementsToInsert = []

      for (const custody of openCustodies) {
        const totalAmt = Number(custody.amount)
        const fundedAmt = Number(custody.funded_amount || 0)
        const missing = totalAmt - fundedAmt

        if (missing > 0 && remaining > 0) {
          const toPay = Math.min(missing, remaining)
          settlementsToInsert.push({
            company_id: companyId,
            employee_custody_id: custody.id,
            expense_id: expense.id,
            amount: toPay
          })
          remaining -= toPay
        }

        if (remaining <= 0) break
      }

      if (settlementsToInsert.length > 0) {
        await supabase.from("employee_custody_settlements").insert(settlementsToInsert)
        revalidatePath("/custodies")
      }
    }
  }

  // ── Smart FIFO Partial Settlement of Vendor POs ──────────────────────────────
  if (input.payment_type === "vendor_payment" && input.vendor_id) {
    const { data: openPOs } = await supabase
      .from("vendor_pos")
      .select("id, amount, paid_amount")
      .eq("vendor_id", input.vendor_id)
      .eq("company_id", companyId)
      .order("po_date", { ascending: true }) // FIFO — oldest first
      .order("created_at", { ascending: true })

    if (openPOs && openPOs.length > 0) {
      let remaining = input.amount
      const settlementsToInsert = []

      for (const po of openPOs) {
        const totalAmt = Number(po.amount)
        const paidAmt = Number(po.paid_amount || 0)
        const missing = totalAmt - paidAmt

        if (missing > 0 && remaining > 0) {
          const toPay = Math.min(missing, remaining)
          settlementsToInsert.push({
            company_id: companyId,
            vendor_po_id: po.id,
            expense_id: expense.id,
            amount: toPay
          })
          remaining -= toPay
        }

        if (remaining <= 0) break
      }

      if (settlementsToInsert.length > 0) {
        await supabase.from("vendor_po_settlements").insert(settlementsToInsert)
        revalidatePath("/vendor-pos")
        revalidatePath("/vendors")
      }
    }
  }

  return { success: true }
}
