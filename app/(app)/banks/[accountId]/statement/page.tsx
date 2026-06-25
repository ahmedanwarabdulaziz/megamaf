import { getBankAccountDetails, getBankStatement } from '@/lib/queries/banks';
import { getBanks } from '@/lib/queries/banks';
import { StatementGrid } from '@/components/banks/statement-grid';
import { AdjustmentModal } from '@/components/banks/adjustment-modal';
import { TransferModal } from '@/components/banks/transfer-modal';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function BankStatementPage({
  params,
  searchParams
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = await params;
  const accountId = resolvedParams.accountId;
  const account = await getBankAccountDetails(accountId);
  const banks = await getBanks();
  
  // We'll pass the initial 50 items to the client component, which can then use server actions or infinite query to load more if needed,
  // or we can handle virtualized paging. We'll implement a simple virtualized grid that can fetch more.
  const statementData = await getBankStatement(accountId, 50, 0);

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Link href="/banks" className="hover:text-foreground transition-colors">البنوك</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">{account.account_name}</span>
      </div>

      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">كشف حساب</h1>
          <div className="flex items-center gap-4 mt-2">
            <p className="text-muted-foreground">البنك: {account.bank_name}</p>
            <p className="text-muted-foreground">رقم الحساب: {account.account_number}</p>
          </div>
          <p className="text-2xl font-bold mt-4 text-primary">{formatMoney(account.current_balance)}</p>
        </div>
        
        <div className="flex gap-2">
          <AdjustmentModal accountId={accountId} />
          <TransferModal banks={banks} currentAccountId={accountId} />
        </div>
      </div>

      <div className="flex-1 bg-card rounded-lg border overflow-hidden">
        <StatementGrid 
          accountId={accountId} 
          initialItems={statementData.items} 
          totalCount={statementData.totalCount} 
        />
      </div>
    </div>
  );
}
