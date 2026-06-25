'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';

export async function addPaymentScheduleRow(formData: FormData) {
  const supabase = await createClient();
  
  const project_id = formData.get('project_id') as string;
  const due_date = formData.get('due_date') as string;
  const expected_amount = parseFloat(formData.get('expected_amount') as string);
  const method = formData.get('method') as string;
  const notes = formData.get('notes') as string;

  const { data: userData } = await supabase.auth.getUser();
  const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
  if (!emp) return { error: 'Employee not found' };

  const insertData = {
    project_id,
    due_date,
    expected_amount,
    method,
    notes,
    status: 'expected'
  };

  const { data: newRow, error } = await supabase
    .from('owner_payment_schedule')
    .insert(insertData)
    .select('id')
    .single();

  if (error) {
    return { error: error.message };
  }

  await logAudit({
    employee_id: emp.id,
    action: 'create',
    entity_type: 'owner_payment_schedule',
    entity_id: newRow.id,
    after: insertData,
  });

  revalidatePath(`/projects/${project_id}`);
  return { success: true };
}

export async function deletePaymentScheduleRow(id: string, project_id: string) {
  const supabase = await createClient();
  
  const { data: userData } = await supabase.auth.getUser();
  const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
  if (!emp) return { error: 'Employee not found' };

  // Fetch before image if needed, or just log deletion
  const { data: oldRow } = await supabase.from('owner_payment_schedule').select('*').eq('id', id).single();

  const { error } = await supabase
    .from('owner_payment_schedule')
    .delete()
    .eq('id', id);

  if (error) {
    return { error: error.message };
  }

  await logAudit({
    employee_id: emp.id,
    action: 'delete',
    entity_type: 'owner_payment_schedule',
    entity_id: id,
    before: oldRow || { id, project_id },
  });

  revalidatePath(`/projects/${project_id}`);
  return { success: true };
}
