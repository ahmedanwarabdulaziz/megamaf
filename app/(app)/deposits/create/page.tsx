import { createClient } from '@/lib/supabase/server';
import { CreateDepositForm } from '@/components/deposits/create-deposit-form';

export const metadata = { title: 'إصدار شهادة بنكية' };

export default async function CreateDepositPage() {
  const supabase = await createClient();
  const { data: bankAccounts } = await supabase.from('v_bank_account_balances').select('*').order('account_name');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">إصدار شهادة بنكية / وديعة</h1>
        <p className="text-muted-foreground mt-1">تسجيل شهادة جديدة وحساب جدول العوائد تلقائياً</p>
      </div>

      <CreateDepositForm bankAccounts={bankAccounts || []} />
    </div>
  );
}
