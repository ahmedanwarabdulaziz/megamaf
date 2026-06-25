'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';

const createDepositSchema = z.object({
  name: z.string().min(1),
  bank_name: z.string().min(1),
  description: z.string().optional(),
  notes: z.string().optional(),
  start_date: z.string(),
  term_months: z.coerce.number().min(1),
  profit_type: z.enum(['fixed_total', 'annual_rate']),
  profit_value: z.coerce.number().min(0),
  payout_frequency: z.enum(['monthly', 'quarterly', 'semiannual', 'annual', 'at_maturity']),
  principal_amount: z.coerce.number().min(0),
  default_bank_account_id: z.string().uuid().optional().or(z.literal('')),
});

export async function createDeposit(formData: FormData) {
  try {
    const supabase = await createClient();
    
    // FormData.get() returns null for missing fields; convert to undefined/empty string
    // so Zod's .optional() and .or(z.literal('')) work correctly.
    const getRaw = (key: string) => {
      const val = formData.get(key);
      return val === null ? undefined : val;
    };

    const parsed = createDepositSchema.safeParse({
      name: getRaw('name'),
      bank_name: getRaw('bank_name'),
      description: getRaw('description') ?? '',
      notes: getRaw('notes') ?? '',
      start_date: getRaw('start_date'),
      term_months: getRaw('term_months'),
      profit_type: getRaw('profit_type'),
      profit_value: getRaw('profit_value'),
      payout_frequency: getRaw('payout_frequency'),
      principal_amount: getRaw('principal_amount'),
      default_bank_account_id: getRaw('default_bank_account_id') ?? '',
    });

    if (!parsed.success) {
        const messages = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { error: `بيانات الوديعة غير صالحة: ${messages}` };
    }

    const d = parsed.data;

    let period_months = 1;
    if (d.payout_frequency === 'monthly') period_months = 1;
    else if (d.payout_frequency === 'quarterly') period_months = 3;
    else if (d.payout_frequency === 'semiannual') period_months = 6;
    else if (d.payout_frequency === 'annual') period_months = 12;
    else if (d.payout_frequency === 'at_maturity') period_months = d.term_months;

    if (d.term_months % period_months !== 0) {
        return { error: `Term (${d.term_months} months) must be evenly divisible by the selected frequency (${period_months} months).` };
    }

    const total_periods = d.term_months / period_months;
    let expected_amount_per_period = 0;

    if (d.profit_type === 'annual_rate') {
        expected_amount_per_period = d.principal_amount * (d.profit_value / 100) * (period_months / 12);
    } else if (d.profit_type === 'fixed_total') {
        expected_amount_per_period = Math.round((d.profit_value / total_periods) * 100) / 100;
    }

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id, is_super_admin').eq('auth_user_id', userData.user?.id).single();
    
    if (!emp) return { error: 'Employee not found' };

    // Insert Header
    const { data: depositData, error: depositError } = await supabase
      .from('deposits')
      .insert({
        name: d.name,
        bank_name: d.bank_name,
        description: d.description,
        notes: d.notes,
        start_date: d.start_date,
        term_months: d.term_months,
        profit_type: d.profit_type,
        profit_value: d.profit_value,
        payout_frequency: d.payout_frequency,
        principal_amount: d.principal_amount,
        default_bank_account_id: d.default_bank_account_id || null,
        created_by: emp.id,
      })
      .select('id')
      .single();

    if (depositError) return { error: depositError.message };

    // Insert Payouts
    const payouts = [];
    let currentUtcDate = new Date(d.start_date + 'T00:00:00Z');

    for (let seq = 1; seq <= total_periods; seq++) {
        const due_date = new Date(currentUtcDate);
        due_date.setUTCMonth(due_date.getUTCMonth() + period_months);
        
        let expected_amount = expected_amount_per_period;
        
        // Push any rounding drift onto the final period
        if (d.profit_type === 'fixed_total' && seq === total_periods) {
            expected_amount = d.profit_value - (expected_amount_per_period * (total_periods - 1));
        }
        
        // Ensure strictly 2 decimal places
        expected_amount = Math.round(expected_amount * 100) / 100;

        payouts.push({
            deposit_id: depositData.id,
            seq: seq,
            due_date: due_date.toISOString().split('T')[0],
            expected_amount: expected_amount,
        });

        currentUtcDate = due_date; // for next iteration
    }

    const { error: payoutsError } = await supabase.from('deposit_payouts').insert(payouts);
    if (payoutsError) {
        await supabase.from('deposits').delete().eq('id', depositData.id);
        return { error: payoutsError.message };
    }

    await logAudit({
      employee_id: emp.id,
      action: 'create',
      entity_type: 'deposit',
      entity_id: depositData.id,
      after: { ...d, payouts_generated: payouts.length },
    });

    revalidatePath('/deposits');
    return { success: true, id: depositData.id };
  } catch (e: any) {
    return { error: e.message || 'An error occurred' };
  }
}

export async function collectDepositPayout(formData: FormData) {
    try {
        const supabase = await createClient();
        const p_payout_id = formData.get('payout_id') as string;
        const p_actual_amount = parseFloat(formData.get('actual_amount') as string);
        const p_date = formData.get('collected_date') as string;
        const p_bank_account_id = formData.get('bank_account_id') as string;
        const p_notes = formData.get('notes') as string;

        const { error } = await supabase.rpc('collect_deposit_payout', {
            p_payout_id,
            p_actual_amount,
            p_date,
            p_bank_account_id,
            p_notes: p_notes || ''
        });

        if (error) return { error: error.message };

        revalidatePath('/deposits');
        return { success: true };
    } catch (e: any) {
        return { error: e.message || 'An error occurred' };
    }
}
