"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { addEmployeeSchema, editEmployeeSchema } from "@/lib/validators/employees"

export async function addEmployee(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const data = Object.fromEntries(formData.entries())
  const is_super_admin = formData.get("is_super_admin") === "on" || formData.get("is_super_admin") === "true"
  const can_have_custody = formData.get("can_have_custody") === "on" || formData.get("can_have_custody") === "true"
  const can_approve_custodies = formData.get("can_approve_custodies") === "on" || formData.get("can_approve_custodies") === "true"
  const parsed = addEmployeeSchema.safeParse({ ...data, is_super_admin, can_have_custody, can_approve_custodies })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: companyId, error: companyError } = await supabase.rpc("get_my_company_id").single()
  if (companyError || !companyId) return { error: "لم يتم العثور على شركتك" }

  const { data: { user } } = await supabase.auth.getUser()

  const { data: newEmployee, error } = await supabase
    .from("employees")
    .insert({
      company_id: companyId,
      name: parsed.data.name,
      job_title: parsed.data.job_title || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      salary: parsed.data.salary ?? null,
      hire_date: parsed.data.hire_date || null,
      status: parsed.data.status,
      is_super_admin: parsed.data.is_super_admin,
      can_have_custody: parsed.data.can_have_custody,
      can_approve_custodies: parsed.data.can_approve_custodies,
      created_by: user?.id,
    })
    .select("id")
    .single()

  if (error || !newEmployee) {
    console.error("Add employee error:", error)
    return { error: "فشل في إضافة الموظف. حاول مرة أخرى." }
  }

  if (!parsed.data.is_super_admin) {
    const projectIds = formData.getAll("project_ids").filter(Boolean)
    if (projectIds.length > 0) {
      await supabase.from("employee_project_access").insert(
        projectIds.map(pid => ({ employee_id: newEmployee.id, project_id: pid as string }))
      )
    }
  }

  revalidatePath("/employees")
  return { success: true }
}

export async function editEmployee(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const data = Object.fromEntries(formData.entries())
  const is_super_admin = formData.get("is_super_admin") === "on" || formData.get("is_super_admin") === "true"
  const can_have_custody = formData.get("can_have_custody") === "on" || formData.get("can_have_custody") === "true"
  const can_approve_custodies = formData.get("can_approve_custodies") === "on" || formData.get("can_approve_custodies") === "true"
  const parsed = editEmployeeSchema.safeParse({ ...data, is_super_admin, can_have_custody, can_approve_custodies })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: companyId, error: companyError } = await supabase.rpc("get_my_company_id").single()
  if (companyError || !companyId) return { error: "لم يتم العثور على شركتك" }

  const { error } = await supabase
    .from("employees")
    .update({
      name: parsed.data.name,
      job_title: parsed.data.job_title || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      salary: parsed.data.salary ?? null,
      hire_date: parsed.data.hire_date || null,
      status: parsed.data.status,
      is_super_admin: parsed.data.is_super_admin,
      can_have_custody: parsed.data.can_have_custody,
      can_approve_custodies: parsed.data.can_approve_custodies,
    })
    .eq("id", parsed.data.id)
    .eq("company_id", companyId)

  if (error) {
    console.error("Edit employee error:", error.message, error.details, error.hint)
    return { error: `فشل في تعديل الموظف: ${error.message}` }
  }

  await supabase.from("employee_project_access").delete().eq("employee_id", parsed.data.id)
  if (!parsed.data.is_super_admin) {
    const projectIds = formData.getAll("project_ids").filter(Boolean)
    if (projectIds.length > 0) {
      await supabase.from("employee_project_access").insert(
        projectIds.map(pid => ({ employee_id: parsed.data.id, project_id: pid as string }))
      )
    }
  }

  revalidatePath("/employees")
  return { success: true }
}

export async function deleteEmployee(id: string) {
  const supabase = await createClient()

  const { data: companyId, error: companyError } = await supabase.rpc("get_my_company_id").single()
  if (companyError || !companyId) return { error: "لم يتم العثور على شركتك" }

  const { error } = await supabase
    .from("employees")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId)

  if (error) {
    console.error("Delete employee error:", error)
    return { error: "فشل في حذف الموظف. حاول مرة أخرى." }
  }

  revalidatePath("/employees")
  return { success: true }
}

// ─── Credentials ────────────────────────────────────────────────────────────

export async function setEmployeeCredentials(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const adminClient = createAdminClient()

  const employeeId = formData.get("employee_id") as string
  const username = (formData.get("username") as string)?.trim().toLowerCase()
  const tempPassword = formData.get("temp_password") as string

  if (!employeeId || !username || !tempPassword) return { error: "جميع الحقول مطلوبة" }
  if (tempPassword.length < 6) return { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }
  if (!/^[a-z0-9_]+$/.test(username)) return { error: "اسم المستخدم يجب أن يحتوي على أحرف إنجليزية وأرقام وشرطة سفلية فقط" }

  const { data: employee } = await supabase
    .from("employees")
    .select("id, name, auth_user_id, username")
    .eq("id", employeeId)
    .single()

  if (!employee) return { error: "الموظف غير موجود" }

  const email = `${username}@megamaf.local`

  if (employee.auth_user_id) {
    const { error } = await adminClient.auth.admin.updateUserById(employee.auth_user_id, {
      password: tempPassword,
      user_metadata: { must_change_password: true },
    })
    if (error) return { error: `فشل في تحديث كلمة المرور: ${error.message}` }
  } else {
    const { data: newUser, error } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: employee.name,
        username,
        must_change_password: true,
        is_employee: true,
        employee_id: employeeId,
      },
    })

    if (error || !newUser?.user) return { error: `فشل في إنشاء الحساب: ${error?.message || "خطأ غير معروف"}` }

    const { error: updateErr } = await supabase
      .from("employees")
      .update({ username, auth_user_id: newUser.user.id })
      .eq("id", employeeId)

    if (updateErr) return { error: "تم إنشاء الحساب لكن فشل الربط. تواصل مع الدعم الفني." }
  }

  revalidatePath("/employees")
  return { success: true }
}

// ─── Page Access ─────────────────────────────────────────────────────────────

export async function updateEmployeePageAccess(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const employeeId = formData.get("employee_id") as string
  if (!employeeId) return { error: "معرف الموظف مطلوب" }

  const pageSlugs = formData.getAll("page_slugs") as string[]

  await supabase.from("employee_page_access").delete().eq("employee_id", employeeId)

  if (pageSlugs.length > 0) {
    const { error } = await supabase.from("employee_page_access").insert(
      pageSlugs.map(slug => ({ employee_id: employeeId, page_slug: slug }))
    )
    if (error) return { error: "فشل في تحديث صلاحيات الصفحات. حاول مرة أخرى." }
  }

  revalidatePath("/employees")
  return { success: true }
}
