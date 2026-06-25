import { createClient } from '@/lib/supabase/server';
import { BankStatementReport } from '@/components/reports/bank-statement-report';
import { Landmark } from 'lucide-react';

export const metadata = { title: 'كشوف حسابات البنوك' };

export default async function BankStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string, date_from?: string, date_to?: string }>
}) {
  const { account_id, date_from, date_to } = await searchParams;
  const supabase = await createClient();

  // Fetch all accounts with live balances for the dropdown
  const { data: accounts } = await supabase
    .from('v_bank_account_balances')
    .select('*')
    .order('account_name');

  let statementData: any[] = [];
  let selectedAccount = null;

  if (account_id && accounts) {
    selectedAccount = accounts.find(a => a.bank_account_id === account_id);
    
    let query = supabase
      .from('v_bank_statement')
      .select('*')
      .eq('bank_account_id', account_id)
      .order('entry_date', { ascending: true })
      .order('ledger_id', { ascending: true })
      .limit(5000); // Max 5000 rows for now, can implement cursor pagination if needed

    if (date_from) query = query.gte('entry_date', date_from);
    if (date_to) query = query.lte('entry_date', date_to);

    const { data } = await query;
    statementData = data || [];
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-full">
          <Landmark className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">كشوف حسابات البنوك</h1>
          <p className="text-muted-foreground mt-1">حركة الخزينة والبنك التفصيلية</p>
        </div>
      </div>

      <BankStatementReport 
        accounts={accounts || []} 
        data={statementData} 
        selectedAccountId={account_id || ''}
        dateFrom={date_from || ''}
        dateTo={date_to || ''}
        openingBalance={selectedAccount?.initial_balance || 0}
      />
    </div>
  );
}
