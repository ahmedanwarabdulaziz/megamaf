'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { headers } from 'next/headers'

export async function saveProject(formData: FormData) {
  const supabase = await createClient()
  
  const id = formData.get('id') as string | null
  const name = formData.get('name') as string
  const code = formData.get('code') as string || null
  const node_type = formData.get('node_type') as string || 'project'
  const parent_id = formData.get('parent_id') as string | null
  const owner_id = formData.get('owner_id') as string || null
  const status = formData.get('status') as string || 'open'
  const notes = formData.get('notes') as string || null
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
    
  const { data: currentEmp } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).single()
  const ip = (await headers()).get('x-forwarded-for') || 'unknown'

  if (id) {
    // Check if main company
    const { data: oldData } = await supabase.from('projects').select('*').eq('id', id).single()
    
    if (oldData?.is_main) {
      if (status === 'closed') throw new Error("لا يمكن إغلاق الشركة الرئيسية")
    }
    
    const payload: any = { name, code, notes }
    if (!oldData?.is_main) {
      payload.status = status
      // If owner cleared, inherit from parent instead of leaving null
      let resolvedOwnerId: string | null = owner_id || null
      if (!resolvedOwnerId && oldData?.parent_id) {
        let currentParentId: string | null = oldData.parent_id as string
        while (currentParentId && !resolvedOwnerId) {
          const res = await supabase
            .from('projects')
            .select('owner_id, parent_id')
            .eq('id', currentParentId)
            .single()
          const row = res.data as { owner_id: string | null; parent_id: string | null } | null
          if (row?.owner_id) {
            resolvedOwnerId = row.owner_id
          } else {
            currentParentId = row?.parent_id ?? null
          }
        }
      }
      payload.owner_id = resolvedOwnerId
    }

    const { error } = await supabase.from('projects').update(payload).eq('id', id)
    if (error) throw error
    
    await logAudit({
      employee_id: currentEmp?.id,
      action: 'update',
      entity_type: 'project',
      entity_id: id,
      before: oldData,
      after: payload,
      ip
    })
  } else {
    // Determine sort_order based on parent
    const { data: siblings } = await supabase.from('projects').select('sort_order').eq('parent_id', parent_id!).order('sort_order', { ascending: false }).limit(1)
    const nextSort = siblings && siblings.length > 0 ? (siblings[0].sort_order || 0) + 1 : 0

    // If no owner selected, inherit from the nearest ancestor that has one
    let resolvedOwnerId: string | null = owner_id || null
    if (!resolvedOwnerId && parent_id) {
      let currentParentId: string | null = parent_id as string
      while (currentParentId && !resolvedOwnerId) {
        const res = await supabase
          .from('projects')
          .select('owner_id, parent_id')
          .eq('id', currentParentId)
          .single()
        const row = res.data as { owner_id: string | null; parent_id: string | null } | null
        if (row?.owner_id) {
          resolvedOwnerId = row.owner_id
        } else {
          currentParentId = row?.parent_id ?? null
        }
      }
    }

    const payload = { 
      name, 
      code, 
      node_type, 
      parent_id, 
      owner_id: resolvedOwnerId, 
      status, 
      notes, 
      sort_order: nextSort,
      is_main: false
    }

    const { data, error } = await supabase.from('projects').insert(payload).select().single()
    if (error) throw error
    
    await logAudit({
      employee_id: currentEmp?.id,
      action: 'create',
      entity_type: 'project',
      entity_id: data.id,
      after: data,
      ip
    })
  }
  
  revalidatePath('/projects')
  revalidatePath('/settings/owners')
}

export async function deleteProject(projectId: string): Promise<{ error: string } | { success: true }> {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'غير مصرح' }

    // Fetch auth checks and project info in parallel
    const [empResult, projectResult] = await Promise.all([
      supabase.from('employees').select('id, is_super_admin').eq('auth_user_id', user.id).single(),
      supabase.from('projects').select('is_main, name').eq('id', projectId).single(),
    ])

    if (!empResult.data?.is_super_admin) return { error: 'غير مصرح: فقط المدير العام يمكنه حذف المشاريع' }

    const project = projectResult.data
    if (!project) return { error: 'المشروع غير موجود' }
    if (project.is_main) return { error: 'لا يمكن حذف الشركة الرئيسية' }

    // Run all data-existence checks in parallel
    const [
      { count: childCount },
      { count: expenseCount },
      { count: ledgerCount },
      { count: invoiceCount },
      { count: claimCount },
      { count: scheduleCount },
    ] = await Promise.all([
      supabase.from('projects').select('id', { count: 'exact', head: true }).eq('parent_id', projectId),
      supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      supabase.from('ledger_entries').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      supabase.from('claims').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      supabase.from('owner_payment_schedule').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    ])

    if ((childCount ?? 0) > 0)    return { error: `لا يمكن الحذف: يحتوي على ${childCount} مشروع فرعي` }
    if ((expenseCount ?? 0) > 0)  return { error: `لا يمكن الحذف: يحتوي على ${expenseCount} مصروف` }
    if ((ledgerCount ?? 0) > 0)   return { error: `لا يمكن الحذف: يحتوي على ${ledgerCount} قيد محاسبي` }
    if ((invoiceCount ?? 0) > 0)  return { error: `لا يمكن الحذف: يحتوي على ${invoiceCount} فاتورة` }
    if ((claimCount ?? 0) > 0)    return { error: `لا يمكن الحذف: يحتوي على ${claimCount} مستخلص` }
    if ((scheduleCount ?? 0) > 0) return { error: `لا يمكن الحذف: يحتوي على ${scheduleCount} جدول دفعات` }

    const ip = (await headers()).get('x-forwarded-for') || 'unknown'

    // Use admin client to bypass RLS (super-admin already verified above)
    const adminClient = createAdminClient()
    const { error: deleteError } = await adminClient
      .from('projects')
      .delete()
      .eq('id', projectId)

    if (deleteError) return { error: deleteError.message }

    await logAudit({
      employee_id: empResult.data.id,
      action: 'delete',
      entity_type: 'project',
      entity_id: projectId,
      before: project,
      ip,
    })

    revalidatePath('/projects')
    revalidatePath('/settings/owners')
    return { success: true }
  } catch (e: any) {
    return { error: e?.message || 'حدث خطأ غير متوقع' }
  }
}
