"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { addProjectSchema, editProjectSchema } from "@/lib/validators/projects"

export async function addProject(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const data = Object.fromEntries(formData.entries())
  const is_company_branch = formData.get("is_company_branch") === "on" || formData.get("is_company_branch") === "true"
  
  const parsed = addProjectSchema.safeParse({ ...data, is_company_branch })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: companyId, error: companyError } = await supabase.rpc("get_my_company_id").single()
  if (companyError || !companyId) return { error: "لم يتم العثور على شركتك" }

  const { data: { user } } = await supabase.auth.getUser()

  // Auto-generate code if not provided
  let projectCode = parsed.data.code
  if (!projectCode) {
    const uniqueSuffix = Math.floor(1000 + Math.random() * 9000).toString()
    projectCode = `PRJ-${uniqueSuffix}`
  }

  const { error } = await supabase
    .from("projects")
    .insert({
      company_id: companyId,
      name: parsed.data.name,
      code: projectCode,
      description: parsed.data.description || null,
      status: parsed.data.status,
      start_date: parsed.data.start_date || null,
      end_date: parsed.data.end_date || null,
      budget: parsed.data.budget ?? null,
      is_company_branch: parsed.data.is_company_branch,
      created_by: user?.id,
    })

  if (error) {
    console.error("Add project error:", error)
    return { error: "فشل في إضافة المشروع. " + error.message }
  }

  revalidatePath("/projects")
  return { success: true }
}

export async function editProject(prevState: any, formData: FormData) {
  const supabase = await createClient()
  const data = Object.fromEntries(formData.entries())
  const is_company_branch = formData.get("is_company_branch") === "on" || formData.get("is_company_branch") === "true"
  
  const parsed = editProjectSchema.safeParse({ ...data, is_company_branch })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data: companyId, error: companyError } = await supabase.rpc("get_my_company_id").single()
  if (companyError || !companyId) return { error: "لم يتم العثور على شركتك" }

  const updateData: any = {
      name: parsed.data.name,
      description: parsed.data.description || null,
      status: parsed.data.status,
      start_date: parsed.data.start_date || null,
      end_date: parsed.data.end_date || null,
      budget: parsed.data.budget ?? null,
      is_company_branch: parsed.data.is_company_branch,
  }

  if (parsed.data.code) {
    updateData.code = parsed.data.code
  }

  const { error } = await supabase
    .from("projects")
    .update(updateData)
    .eq("id", parsed.data.id)
    .eq("company_id", companyId)

  if (error) {
    console.error("Edit project error:", error)
    return { error: `فشل في تعديل المشروع: ${error.message}` }
  }

  revalidatePath("/projects")
  return { success: true }
}

export async function deleteProject(id: string) {
  const supabase = await createClient()

  const { data: companyId, error: companyError } = await supabase.rpc("get_my_company_id").single()
  if (companyError || !companyId) return { error: "لم يتم العثور على شركتك" }

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId)

  if (error) {
    console.error("Delete project error:", error)
    return { error: "فشل في حذف المشروع. قد يكون المشروع فرعاً رئيسياً للشركة لا يمكن حذفه، أو مرتبطاً بسجلات أخرى." }
  }

  revalidatePath("/projects")
  return { success: true }
}
