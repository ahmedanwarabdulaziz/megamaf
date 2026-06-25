'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const categorySchema = z.object({
  name: z.string().min(2),
  parent_id: z.string().uuid().optional().nullable(),
});

export async function createExpenseCategory(formData: FormData) {
  const supabase = await createClient();
  
  const parsed = categorySchema.safeParse({
    name: formData.get('name'),
    parent_id: formData.get('parent_id') || null,
  });

  if (!parsed.success) {
    throw new Error('Invalid category data');
  }

  const { data: userData } = await supabase.auth.getUser();
  const { data: employeeData } = await supabase
    .from('employees')
    .select('id')
    .eq('auth_user_id', userData.user?.id)
    .single();

  const { data, error } = await supabase
    .from('expense_categories')
    .insert({
      name: parsed.data.name,
      parent_id: parsed.data.parent_id,
    })
    .select('id')
    .single();

  if (error) throw error;

  await logAudit({
    employee_id: employeeData?.id,
    action: 'create',
    entity_type: 'expense_category',
    entity_id: data.id,
    after: parsed.data,
  });

  revalidatePath('/settings/expenses');
  return data;
}

const toggleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

export async function toggleExpenseCategory(id: string, is_active: boolean) {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const { data: employeeData } = await supabase
    .from('employees')
    .select('id')
    .eq('auth_user_id', userData.user?.id)
    .single();

  const { error } = await supabase
    .from('expense_categories')
    .update({ is_active })
    .eq('id', id);

  if (error) throw error;

  await logAudit({
    employee_id: employeeData?.id,
    action: 'update',
    entity_type: 'expense_category',
    entity_id: id,
    after: { is_active },
  });

  revalidatePath('/settings/expenses');
}

export async function deleteExpenseCategory(id: string): Promise<{ error: string } | { success: true }> {
  try {
    const supabase = await createClient();

    // Auth check — super admins only
    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase
      .from('employees')
      .select('id, is_super_admin')
      .eq('auth_user_id', userData.user?.id)
      .single();
    if (!emp?.is_super_admin) return { error: 'غير مصرح' };

    // Check: no expenses use this category
    const { count: expenseCount } = await supabase
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);
    if ((expenseCount ?? 0) > 0)
      return { error: `لا يمكن الحذف: مرتبط بـ ${expenseCount} مصروف` };

    // Check: no child categories exist (for parent categories)
    const { count: childCount } = await supabase
      .from('expense_categories')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', id);
    if ((childCount ?? 0) > 0)
      return { error: `لا يمكن الحذف: يحتوي على ${childCount} تصنيف فرعي` };

    // Safe to delete — use admin client to bypass RLS
    const admin = createAdminClient();
    const { error: deleteError } = await admin
      .from('expense_categories')
      .delete()
      .eq('id', id);
    if (deleteError) return { error: deleteError.message };

    await logAudit({
      employee_id: emp.id,
      action: 'delete',
      entity_type: 'expense_category',
      entity_id: id,
    });

    revalidatePath('/settings/expenses');
    return { success: true };
  } catch (e: any) {
    return { error: e?.message || 'حدث خطأ غير متوقع' };
  }
}
