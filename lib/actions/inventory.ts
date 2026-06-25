'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createItem(formData: FormData) {
  const supabase = await createClient();
  const name = (formData.get('name') as string)?.trim();
  const code = (formData.get('code') as string)?.trim() || null;
  const unit = (formData.get('unit') as string)?.trim();

  if (!name || !unit) return { error: 'الاسم والوحدة مطلوبان' };

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({ name, code, unit })
    .select('id, name, unit, code')
    .single();

  if (error) return { error: error.message };

  revalidatePath('/inventory/items');
  return { success: true, item: data };
}

export async function createWarehouse(formData: FormData) {
  const supabase = await createClient();
  const name = formData.get('name') as string;
  const project_id = formData.get('project_id') as string;

  const { error } = await supabase.from('warehouses').insert({ 
    name, 
    project_id: project_id ? project_id : null 
  });
  if (error) return { error: error.message };

  revalidatePath('/inventory/warehouses');
  return { success: true };
}

export async function recordTransfer(formData: FormData) {
  const supabase = await createClient();
  const p_from_warehouse_id = formData.get('from_warehouse_id') as string;
  const p_to_warehouse_id = formData.get('to_warehouse_id') as string;
  const p_item_id = formData.get('item_id') as string;
  const p_qty = parseFloat(formData.get('qty') as string);
  const p_notes = formData.get('notes') as string;

  const { error } = await supabase.rpc('record_stock_transfer', {
    p_from_warehouse_id,
    p_to_warehouse_id,
    p_item_id,
    p_qty,
    p_notes
  });

  if (error) return { error: error.message };

  revalidatePath('/inventory');
  return { success: true };
}
