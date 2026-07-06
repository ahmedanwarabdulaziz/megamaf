'use server';

import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const createBankSchema = z.object({
  name: z.string().min(2),
});

export async function createBank(formData: FormData) {
  const supabase = await createClient();
  
  const parsed = createBankSchema.safeParse({
    name: formData.get('name'),
  });

  if (!parsed.success) {
    throw new Error('Invalid bank name');
  }

  const { data, error } = await supabase
    .from('banks')
    .insert({ name: parsed.data.name })
    .select('id')
    .single();

  if (error) throw error;

  await logAudit({
    action: 'create',
    entity_type: 'bank',
    entity_id: data.id,
    after: parsed.data,
  });

  revalidatePath('/banks');
  return data;
}

const createAccountSchema = z.object({
  bank_id: z.string().uuid(),
  account_name: z.string().min(2),
  account_number: z.string().min(1),
  opening_balance: z.coerce.number(),
  currency: z.string().default('EGP'),
});

export async function createBankAccount(formData: FormData) {
  const supabase = await createClient();
  
  const parsed = createAccountSchema.safeParse({
    bank_id: formData.get('bank_id'),
    account_name: formData.get('account_name'),
    account_number: formData.get('account_number'),
    opening_balance: formData.get('opening_balance'),
    currency: formData.get('currency') || 'EGP',
  });

  if (!parsed.success) {
    throw new Error('Invalid account data');
  }

  const { data, error } = await supabase.rpc('create_bank_account', {
    p_bank_id: parsed.data.bank_id,
    p_account_name: parsed.data.account_name,
    p_account_number: parsed.data.account_number,
    p_opening_balance: parsed.data.opening_balance,
    p_currency: parsed.data.currency,
  });

  if (error) throw error;

  revalidatePath('/banks');
  return data;
}

const adjustmentSchema = z.object({
  bank_account_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  type: z.enum(['interest', 'deduction']),
  date: z.string(),
  memo: z.string(),
});

export async function addAdjustment(formData: FormData) {
  const supabase = await createClient();
  
  const parsed = adjustmentSchema.safeParse({
    bank_account_id: formData.get('bank_account_id'),
    amount: formData.get('amount'),
    type: formData.get('type'),
    date: formData.get('date'),
    memo: formData.get('memo'),
  });

  if (!parsed.success) {
    throw new Error('Invalid adjustment data');
  }

  const { data, error } = await supabase.rpc('add_ledger_adjustment', {
    p_bank_account_id: parsed.data.bank_account_id,
    p_amount: parsed.data.amount,
    p_type: parsed.data.type,
    p_date: parsed.data.date,
    p_memo: parsed.data.memo,
  });

  if (error) throw error;

  revalidatePath(`/banks/${parsed.data.bank_account_id}/statement`);
  revalidatePath('/banks');
  return data;
}

const transferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  date: z.string(),
  memo: z.string(),
});

export async function createTransfer(formData: FormData) {
  const supabase = await createClient();
  
  const parsed = transferSchema.safeParse({
    from_account_id: formData.get('from_account_id'),
    to_account_id: formData.get('to_account_id'),
    amount: formData.get('amount'),
    date: formData.get('date'),
    memo: formData.get('memo'),
  });

  if (!parsed.success) throw new Error('Invalid transfer data');
  if (parsed.data.from_account_id === parsed.data.to_account_id) {
    throw new Error('Cannot transfer to the same account');
  }

  const { error } = await supabase.rpc('create_transfer', {
    p_from_account_id: parsed.data.from_account_id,
    p_to_account_id: parsed.data.to_account_id,
    p_amount: parsed.data.amount,
    p_date: parsed.data.date,
    p_memo: parsed.data.memo,
  });

  if (error) throw error;

  revalidatePath('/banks');
  return true;
}

const updateAccountSchema = z.object({
  bank_account_id: z.string().uuid(),
  opening_balance: z.coerce.number(),
});

export async function updateBankAccountOpeningBalance(formData: FormData) {
  const supabase = await createClient();
  
  const parsed = updateAccountSchema.safeParse({
    bank_account_id: formData.get('bank_account_id'),
    opening_balance: formData.get('opening_balance'),
  });

  if (!parsed.success) {
    throw new Error('Invalid account data');
  }

  const bankAccountId = parsed.data.bank_account_id;
  const newBalance = parsed.data.opening_balance;

  // Use the RPC which atomically updates bank_accounts + ledger_entries
  // in a SECURITY DEFINER context, bypassing RLS restrictions on ledger updates.
  const { error } = await supabase.rpc('update_bank_account_opening_balance', {
    p_bank_account_id: bankAccountId,
    p_opening_balance: newBalance,
  });

  if (error) throw error;

  revalidatePath('/banks');
  revalidatePath(`/banks/${bankAccountId}/statement`);
}
