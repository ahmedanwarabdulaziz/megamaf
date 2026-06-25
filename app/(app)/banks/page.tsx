import { getBanks } from '@/lib/queries/banks';
import { Card } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { CreateBankModal } from '@/components/banks/create-bank-modal';
import { CreateAccountModal } from '@/components/banks/create-account-modal';

export const dynamic = 'force-dynamic';

export default async function BanksPage() {
  const banks = await getBanks();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">البنوك والحسابات</h1>
          <p className="text-muted-foreground mt-2">إدارة الحسابات البنكية والأرصدة</p>
        </div>
        <div className="flex gap-2">
          <CreateBankModal />
          {banks.length > 0 && <CreateAccountModal banks={banks} />}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {banks.map((bank) => (
          <Card key={bank.id} className="p-6">
            <h3 className="text-lg font-semibold mb-4">{bank.name}</h3>
            {bank.accounts?.length > 0 ? (
              <div className="space-y-3">
                {bank.accounts.map((account: any) => (
                  <div key={account.bank_account_id} className="flex justify-between items-center p-3 bg-accent/50 rounded-lg">
                    <div>
                      <p className="font-medium">{account.account_name}</p>
                      <p className="text-sm text-muted-foreground">{account.account_number}</p>
                    </div>
                    <div className="text-left">
                      <p className="font-semibold">{formatMoney(account.current_balance)}</p>
                      <Link 
                        href={`/banks/${account.bank_account_id}/statement`}
                        className="text-xs text-primary hover:underline"
                      >
                        كشف الحساب
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد حسابات مسجلة</p>
            )}
          </Card>
        ))}
        {banks.length === 0 && (
          <div className="col-span-full p-8 text-center text-muted-foreground bg-accent/30 rounded-lg border border-dashed">
            لا توجد بنوك مسجلة حالياً
          </div>
        )}
      </div>
    </div>
  );
}
