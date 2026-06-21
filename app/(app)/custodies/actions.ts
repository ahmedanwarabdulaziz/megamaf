"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createR2Client, R2_BUCKET } from "@/lib/r2"
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { addCustodySchema, editCustodySchema } from "@/lib/validators/custodies"

// ─── Permission helper ────────────────────────────────────────────────────────

async function getUserCustodyPerms(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  // Company owner / admin: full access
  if (profile?.role === "admin" || profile?.role === "member") {
    return { canApprove: true, canUnapprove: true, canEditApproved: true, isSuperAdmin: true }
  }

  // Employee: check flags
  const { data: emp } = await supabase
    .from("employees")
    .select("is_super_admin, can_approve_custodies")
    .eq("auth_user_id", userId)
    .single()

  if (emp?.is_super_admin) {
    return { canApprove: true, canUnapprove: true, canEditApproved: true, isSuperAdmin: true }
  }
  if (emp?.can_approve_custodies) {
    return { canApprove: true, canUnapprove: false, canEditApproved: false, isSuperAdmin: false }
  }
  return { canApprove: false, canUnapprove: false, canEditApproved: false, isSuperAdmin: false }
}

// ─── File helpers ─────────────────────────────────────────────────────────────

async function uploadFileToR2(file: File, companyId: string): Promise<string | null> {
  if (!file || file.size === 0) return null
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin"
  const key = `${companyId}/${crypto.randomUUID()}.${ext}`
  const r2 = createR2Client()
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type,
  }))
  return key
}

async function deleteFileFromR2(key: string) {
  try {
    const r2 = createR2Client()
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
  } catch (e) { console.error("R2 delete error:", e) }
}

// ─── Add Custody ──────────────────────────────────────────────────────────────

export async function addCustody(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const data = Object.fromEntries([...formData.entries()].filter(([k]) => k !== "file"))
  const parsed = addCustodySchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { data: companyId, error: companyError } = await supabase.rpc("get_my_company_id").single()
  if (companyError || !companyId) return { error: "لم يتم العثور على شركتك" }

  const { data: { user } } = await supabase.auth.getUser()
  const file = formData.get("file") as File | null

  let file_path: string | null = null
  if (file && file.size > 0) {
    try {
      file_path = await uploadFileToR2(file, companyId as string)
    } catch (uploadErr: any) {
      console.error("[addCustody] R2 upload FAILED:", uploadErr?.message)
      return { error: `فشل رفع الملف: ${uploadErr?.message ?? "خطأ غير معروف"}` }
    }
  }

  const { error } = await supabase.from("employee_custodies").insert({
    company_id: companyId,
    employee_id: parsed.data.employee_id,
    date: parsed.data.date,
    item: parsed.data.item,
    amount: parsed.data.amount,
    notes: parsed.data.notes || null,
    project_id: parsed.data.project_id || null,
    file_path,
    created_by: user?.id,
  })

  if (error) {
    if (file_path) await deleteFileFromR2(file_path)
    return { error: `فشل في إضافة العهدة: ${error.message}` }
  }

  revalidatePath("/custodies")
  return { success: true }
}

// ─── Edit Custody ─────────────────────────────────────────────────────────────

export async function editCustody(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const data = Object.fromEntries([...formData.entries()].filter(([k]) => k !== "file"))
  const parsed = editCustodySchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لم يتم العثور على شركتك" }

  // Fetch existing to check approval status
  const { data: existing } = await supabase
    .from("employee_custodies")
    .select("file_path, approved_at")
    .eq("id", parsed.data.id)
    .single()

  // If approved, only super admin / admin can edit
  if (existing?.approved_at) {
    const perms = await getUserCustodyPerms(supabase, user!.id)
    if (!perms.canEditApproved) {
      return { error: "لا يمكن تعديل عهدة معتمدة. تواصل مع السوبر أدمن لإلغاء الاعتماد أولاً." }
    }
  }

  // Handle file
  let file_path = existing?.file_path ?? null
  const file = formData.get("file") as File | null
  if (file && file.size > 0) {
    const newPath = await uploadFileToR2(file, companyId as string)
    if (newPath) {
      if (existing?.file_path) await deleteFileFromR2(existing.file_path)
      file_path = newPath
    }
  }
  if (formData.get("remove_file") === "true" && existing?.file_path) {
    await deleteFileFromR2(existing.file_path)
    file_path = null
  }

  const { error } = await supabase
    .from("employee_custodies")
    .update({
      employee_id: parsed.data.employee_id,
      date: parsed.data.date,
      item: parsed.data.item,
      amount: parsed.data.amount,
      notes: parsed.data.notes || null,
      project_id: parsed.data.project_id || null,
      file_path,
    })
    .eq("id", parsed.data.id)
    .eq("company_id", companyId)

  if (error) return { error: `فشل في تعديل العهدة: ${error.message}` }

  revalidatePath("/custodies")
  return { success: true }
}

// ─── Delete Custody ───────────────────────────────────────────────────────────

export async function deleteCustody(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لم يتم العثور على شركتك" }

  const { data: custody } = await supabase
    .from("employee_custodies")
    .select("file_path, approved_at")
    .eq("id", id)
    .single()

  // Block delete on approved custodies unless super admin
  if (custody?.approved_at) {
    const perms = await getUserCustodyPerms(supabase, user!.id)
    if (!perms.canEditApproved) {
      return { error: "لا يمكن حذف عهدة معتمدة." }
    }
  }

  const { error } = await supabase
    .from("employee_custodies")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId)

  if (error) return { error: `فشل في حذف العهدة: ${error.message}` }
  if (custody?.file_path) await deleteFileFromR2(custody.file_path)

  revalidatePath("/custodies")
  return { success: true }
}

// ─── Approve (manager step) ──────────────────────────────────────────────────
export async function approveCustody(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لم يتم العثور على شركتك" }

  const perms = await getUserCustodyPerms(supabase, user!.id)
  if (!perms.canApprove) return { error: "ليس لديك صلاحية اعتماد العهد." }

  const { data: custody } = await supabase
    .from("employee_custodies")
    .select("funded_at, employee_id")
    .eq("id", id)
    .single()
  if (custody?.funded_at) return { error: "هذه العهدة تم صرفها مسبقاً." }

  const { error } = await supabase
    .from("employee_custodies")
    .update({ approved_at: new Date().toISOString(), approved_by: user!.id })
    .eq("id", id)
    .eq("company_id", companyId)

  if (error) return { error: `فشل في اعتماد العهدة: ${error.message}` }

  // ── Auto-Settle with Existing Surplus Payments ──────────────────────────
  const { data: surplusPayments } = await supabase
    .from("expenses")
    .select("id, amount, allocated_amount")
    .in("payment_type", ["employee_advance", "direct"])
    .eq("employee_id", custody!.employee_id)
    .eq("company_id", companyId)
    .order("expense_date", { ascending: true })
    .order("created_at", { ascending: true })

  if (surplusPayments && surplusPayments.length > 0) {
    const { data: openCustodies } = await supabase
      .from("employee_custodies")
      .select("id, amount, funded_amount")
      .eq("employee_id", custody!.employee_id)
      .eq("company_id", companyId)
      .not("approved_at", "is", null)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true })

    if (openCustodies && openCustodies.length > 0) {
      const settlementsToInsert = []
      let pIdx = 0
      
      for (const oc of openCustodies) {
        let missing = Number(oc.amount) - Number(oc.funded_amount || 0)
        
        while (missing > 0 && pIdx < surplusPayments.length) {
          const payment = surplusPayments[pIdx]
          const surplus = Number(payment.amount) - Number(payment.allocated_amount || 0)
          
          if (surplus <= 0) {
            pIdx++
            continue
          }
          
          const toPay = Math.min(missing, surplus)
          settlementsToInsert.push({
            company_id: companyId,
            employee_custody_id: oc.id,
            expense_id: payment.id,
            amount: toPay
          })
          
          missing -= toPay
          payment.allocated_amount = (Number(payment.allocated_amount || 0) + toPay) as any
          
          if (missing <= 0) break
        }
      }

      if (settlementsToInsert.length > 0) {
        await supabase.from("employee_custody_settlements").insert(settlementsToInsert)
      }
    }
  }

  revalidatePath("/")
  revalidatePath("/custodies")
  revalidatePath("/payments")
  return { success: true }
}

// ─── Pay (finance step) ───────────────────────────────────────────────────────
// Called from the payments page. Creates expense + bank transaction + marks funded.
export async function payCustody(id: string, bankAccountId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لم يتم العثور على شركتك" }
  if (!bankAccountId) return { error: "يجب اختيار حساب بنكي" }

  const { data: custody, error: fetchErr } = await supabase
    .from("employee_custodies")
    .select("id, amount, employee_id, item, date, funded_at, approved_at, project_id")
    .eq("id", id)
    .eq("company_id", companyId)
    .single()

  if (fetchErr || !custody) return { error: "لم يتم العثور على العهدة" }
  if (!custody.approved_at) return { error: "يجب اعتماد العهدة أولاً قبل الصرف" }
  if (custody.funded_at) return { error: "هذه العهدة تم صرفها مسبقاً." }

  const now = new Date().toISOString()
  const expenseDate = custody.date || now.split("T")[0]

  // 1. Create project expense record
  const { data: expense, error: expenseErr } = await supabase
    .from("expenses")
    .insert({
      company_id: companyId,
      employee_id: custody.employee_id,
      custody_id: custody.id,
      bank_account_id: bankAccountId,
      description: custody.item,
      amount: custody.amount,
      expense_date: expenseDate,
      project_id: custody.project_id,
      created_by: user!.id,
    })
    .select("id")
    .single()

  if (expenseErr || !expense) return { error: `فشل إنشاء سجل المصروف: ${expenseErr?.message}` }

  // 2. Create bank withdrawal transaction
  const { error: txErr } = await supabase
    .from("bank_transactions")
    .insert({
      company_id: companyId,
      bank_account_id: bankAccountId,
      type: "withdrawal",
      amount: custody.amount,
      transaction_date: expenseDate,
      description: `عهدة: ${custody.item}`,
      reference_type: "custody",
      reference_id: custody.id,
    })

  if (txErr) {
    await supabase.from("expenses").delete().eq("id", expense.id)
    return { error: `فشل تسجيل المعاملة البنكية: ${txErr.message}` }
  }

  // 3. Mark custody as funded
  const { error: updateErr } = await supabase
    .from("employee_custodies")
    .update({
      approved_at: now,
      approved_by: user!.id,
      bank_account_id: bankAccountId,
      funded_at: now,
    })
    .eq("id", id)
    .eq("company_id", companyId)

  if (updateErr) {
    // Rollback both records
    await supabase.from("expenses").delete().eq("id", expense.id)
    await supabase.from("bank_transactions").delete().eq("reference_type", "custody").eq("reference_id", id)
    return { error: `فشل في تحديث العهدة: ${updateErr.message}` }
  }

  revalidatePath("/custodies")
  return { success: true }
}

export async function unapproveCustody(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: companyId } = await supabase.rpc("get_my_company_id").single()
  if (!companyId) return { error: "لم يتم العثور على شركتك" }

  const perms = await getUserCustodyPerms(supabase, user!.id)
  if (!perms.canUnapprove) return { error: "فقط السوبر أدمن يمكنه إلغاء اعتماد العهد." }

  // Block unapprove if already funded
  const { data: custody } = await supabase
    .from("employee_custodies")
    .select("funded_at")
    .eq("id", id)
    .single()

  if (custody?.funded_at) {
    return { error: "هذه العهدة تم صرفها وتحولت إلى مصروف — لا يمكن إلغاء اعتمادها." }
  }

  const { error } = await supabase
    .from("employee_custodies")
    .update({ approved_at: null, approved_by: null })
    .eq("id", id)
    .eq("company_id", companyId)

  if (error) return { error: `فشل في إلغاء اعتماد العهدة: ${error.message}` }

  revalidatePath("/custodies")
  return { success: true }
}

// ─── Signed URL helper ────────────────────────────────────────────────────────

export async function getSignedFileUrl(key: string): Promise<string | null> {
  try {
    const r2 = createR2Client()
    return await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 })
  } catch { return null }
}
