'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { headers } from 'next/headers'

export async function assignProjectToOwner(projectId: string, ownerId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: currentEmp } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).single()
  const ip = (await headers()).get('x-forwarded-for') || 'unknown'

  const { data: oldData } = await supabase.from('projects').select('*').eq('id', projectId).single()
  const { error } = await supabase.from('projects').update({ owner_id: ownerId }).eq('id', projectId)
  if (error) throw error

  await logAudit({
    employee_id: currentEmp?.id,
    action: 'update',
    entity_type: 'project',
    entity_id: projectId,
    before: oldData,
    after: { ...oldData, owner_id: ownerId },
    ip,
  })

  revalidatePath('/settings/owners')
  revalidatePath('/projects')
}

export async function unassignProject(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: currentEmp } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).single()
  const ip = (await headers()).get('x-forwarded-for') || 'unknown'

  const { data: oldData } = await supabase.from('projects').select('*').eq('id', projectId).single()
  const { error } = await supabase.from('projects').update({ owner_id: null }).eq('id', projectId)
  if (error) throw error

  await logAudit({
    employee_id: currentEmp?.id,
    action: 'update',
    entity_type: 'project',
    entity_id: projectId,
    before: oldData,
    after: { ...oldData, owner_id: null },
    ip,
  })

  revalidatePath('/settings/owners')
  revalidatePath('/projects')
}

export async function saveOwner(formData: FormData) {
  const supabase = await createClient()
  
  const id = formData.get('id') as string | null
  const name = formData.get('name') as string
  const phone = formData.get('phone') as string
  const notes = formData.get('notes') as string
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
    
  const { data: currentEmp } = await supabase.from('employees').select('id').eq('auth_user_id', user.id).single()
  const ip = (await headers()).get('x-forwarded-for') || 'unknown'

  const payload = { name, phone, notes }

  if (id) {
    const { data: oldData } = await supabase.from('project_owners').select('*').eq('id', id).single()
    const { error } = await supabase.from('project_owners').update(payload).eq('id', id)
    if (error) throw error
    
    await logAudit({
      employee_id: currentEmp?.id,
      action: 'update',
      entity_type: 'project_owner',
      entity_id: id,
      before: oldData,
      after: payload,
      ip
    })
  } else {
    const { data, error } = await supabase.from('project_owners').insert(payload).select().single()
    if (error) throw error
    
    await logAudit({
      employee_id: currentEmp?.id,
      action: 'create',
      entity_type: 'project_owner',
      entity_id: data.id,
      after: data,
      ip
    })
  }
  
  revalidatePath('/settings/owners')
  revalidatePath('/projects')
}
