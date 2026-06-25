'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function saveFinancialBalance(formData: FormData) {
  const supabase = await createClient();
  const projectId = formData.get('project_id') as string;
  const cutoffDate = formData.get('cutoff_date') as string;
  const priorExpenses = parseFloat(formData.get('prior_expenses') as string) || 0;
  const priorOwnerIncome = parseFloat(formData.get('prior_owner_income') as string) || 0;
  const notes = (formData.get('notes') as string) || null;

  const { error } = await supabase.rpc('upsert_project_opening_balance', {
    p_project_id: projectId,
    p_cutoff_date: cutoffDate,
    p_prior_expenses: priorExpenses,
    p_prior_owner_income: priorOwnerIncome,
    p_notes: notes,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

export async function saveVendorPriorClaim(formData: FormData) {
  const supabase = await createClient();
  const projectId = formData.get('project_id') as string;
  const vendorId = formData.get('vendor_id') as string;
  const cutoffDate = formData.get('cutoff_date') as string;
  const certified = parseFloat(formData.get('prior_certified_amount') as string) || 0;
  const paid = parseFloat(formData.get('prior_paid_amount') as string) || 0;
  const retention = parseFloat(formData.get('prior_retention_held') as string) || 0;
  const notes = (formData.get('notes') as string) || null;

  const { error } = await supabase.rpc('upsert_vendor_prior_claim', {
    p_project_id: projectId,
    p_vendor_id: vendorId,
    p_cutoff_date: cutoffDate,
    p_prior_certified_amount: certified,
    p_prior_paid_amount: paid,
    p_prior_retention_held: retention,
    p_notes: notes,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteVendorPriorClaim(id: string, projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_vendor_prior_claim', { p_id: id });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

export async function saveOpeningStockEntry(formData: FormData) {
  const supabase = await createClient();
  const projectId = formData.get('project_id') as string;
  const warehouseId = formData.get('warehouse_id') as string;
  const itemId = formData.get('item_id') as string;
  const qty = parseFloat(formData.get('qty') as string) || 0;
  const unitPrice = parseFloat(formData.get('unit_price') as string) || 0;
  const cutoffDate = formData.get('cutoff_date') as string;
  const notes = (formData.get('notes') as string) || null;

  const { error } = await supabase.rpc('upsert_opening_stock_entry', {
    p_project_id: projectId,
    p_warehouse_id: warehouseId,
    p_item_id: itemId,
    p_qty: qty,
    p_unit_price: unitPrice,
    p_cutoff_date: cutoffDate,
    p_notes: notes,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteOpeningStockEntry(entryId: string, projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_opening_stock_entry', { p_entry_id: entryId });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
