'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createItem(formData: FormData) {
  const supabase = await createClient();
  const name = (formData.get('name') as string)?.trim();
  const code = (formData.get('code') as string)?.trim() || null;
  const unit = (formData.get('unit') as string)?.trim();
  const category_id = (formData.get('category_id') as string) || null;

  if (!name || !unit) return { error: 'الاسم والوحدة مطلوبان' };
  if (!category_id) return { error: 'فئة الصنف مطلوبة' };

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({ name, code, unit, category_id })
    .select('id, name, unit, code, category_id')
    .single();

  if (error) return { error: error.message };

  revalidatePath('/inventory/items');
  return { success: true, item: data };
}

export async function updateItem(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get('id') as string;
  const name = (formData.get('name') as string)?.trim();
  const code = (formData.get('code') as string)?.trim() || null;
  const unit = (formData.get('unit') as string)?.trim();
  const category_id = (formData.get('category_id') as string) || null;

  if (!id) return { error: 'الصنف غير محدد' };
  if (!name || !unit) return { error: 'الاسم والوحدة مطلوبان' };
  if (!category_id) return { error: 'فئة الصنف مطلوبة' };

  const { error } = await supabase
    .from('inventory_items')
    .update({ name, code, unit, category_id, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    if (error.code === '23505') return { error: 'يوجد صنف آخر بنفس الكود' };
    return { error: error.message };
  }

  revalidatePath('/inventory/items');
  return { success: true };
}

export async function deleteItem(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get('id') as string;
  if (!id) return { error: 'الصنف غير محدد' };

  const { error } = await supabase.from('inventory_items').delete().eq('id', id);
  if (error) {
    // FK violation: item has stock movements, invoice items, or claim items referencing it
    if (error.code === '23503') return { error: 'لا يمكن حذف هذا الصنف لوجود حركات مخزنية أو فواتير/مستخلصات مرتبطة به' };
    return { error: error.message };
  }

  revalidatePath('/inventory/items');
  return { success: true };
}

export async function createItemCategory(formData: FormData) {
  const supabase = await createClient();
  const name = (formData.get('name') as string)?.trim();
  const parent_id = (formData.get('parent_id') as string) || null;

  if (!name) return { error: 'اسم الفئة مطلوب' };

  const { error } = await supabase.from('item_categories').insert({ name, parent_id });
  if (error) {
    if (error.code === '23505') return { error: 'يوجد فئة بنفس الاسم في هذا المستوى' };
    return { error: error.message };
  }

  revalidatePath('/inventory/categories');
  revalidatePath('/inventory/items');
  return { success: true };
}

export async function renameItemCategory(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get('id') as string;
  const name = (formData.get('name') as string)?.trim();

  if (!id || !name) return { error: 'اسم الفئة مطلوب' };

  const { error } = await supabase.from('item_categories').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    if (error.code === '23505') return { error: 'يوجد فئة بنفس الاسم في هذا المستوى' };
    return { error: error.message };
  }

  revalidatePath('/inventory/categories');
  revalidatePath('/inventory/items');
  return { success: true };
}

export async function deleteItemCategory(formData: FormData) {
  const supabase = await createClient();
  const id = formData.get('id') as string;
  if (!id) return { error: 'الفئة غير محددة' };

  const { error } = await supabase.from('item_categories').delete().eq('id', id);
  if (error) {
    // FK violation: category has items or sub-categories attached
    if (error.code === '23503') return { error: 'لا يمكن حذف الفئة لوجود أصناف أو فئات فرعية مرتبطة بها' };
    return { error: error.message };
  }

  revalidatePath('/inventory/categories');
  revalidatePath('/inventory/items');
  return { success: true };
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
