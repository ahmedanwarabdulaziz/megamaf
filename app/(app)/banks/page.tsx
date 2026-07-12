import { getBanks } from '@/lib/queries/banks';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { CreateBankModal } from '@/components/banks/create-bank-modal';
import { CreateAccountModal } from '@/components/banks/create-account-modal';
import { EditOpeningBalanceModal } from '@/components/banks/edit-opening-balance-modal';
import { Building2, ArrowLeftRight, Landmark } from 'lucide-react';
import { requirePageAccess } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';

export default async function BanksPage() {
  await requirePageAccess('banks');
  const banks = await getBanks();

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Landmark className="w-8 h-8 text-primary" /> البنوك والحسابات
          </h1>
          <p className="text-muted-foreground mt-2">إدارة الحسابات البنكية والأرصدة</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/banks/transactions"
            className="text-sm font-medium bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded-md transition-colors flex items-center gap-1.5"
          >
            <ArrowLeftRight className="w-4 h-4" /> كل المعاملات البنكية
          </Link>
          <CreateBankModal />
          {banks.length > 0 && <CreateAccountModal banks={banks} />}
        </div>
      </div>

      <div className="space-y-8">
        {banks.map((bank) => (
          <div key={bank.id}>
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-bold">{bank.name}</h2>
            </div>

            <div className="bg-card rounded-lg border shadow-sm overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-muted/50 border-b whitespace-nowrap">
                  <tr>
                    <th className="p-4 font-medium">الحساب</th>
                    <th className="p-4 font-medium">الرصيد الحالي</th>
                    <th className="p-4 font-medium text-emerald-600">إيداعات الشهر</th>
                    <th className="p-4 font-medium text-rose-600">سحوبات الشهر</th>
                    <th className="p-4 font-medium w-40">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bank.accounts?.length > 0 ? (
                    bank.accounts.map((account: any) => (
                      <tr key={account.bank_account_id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4 font-semibold whitespace-nowrap">
                          <div className="group relative inline-block cursor-default">
                            <span className="border-b border-dotted border-muted-foreground/50">{account.account_name}</span>
                            <div className="absolute z-20 hidden group-hover:flex flex-col gap-1.5 top-full right-0 mt-1.5 whitespace-nowrap rounded-md border bg-popover text-popover-foreground px-3 py-2 text-xs shadow-md">
                              <span className="text-muted-foreground" dir="ltr">{account.account_number}</span>
                              <span className="w-fit text-[10px] px-2 py-0.5 rounded-full bg-muted border font-semibold text-muted-foreground">
                                {account.currency}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className={`font-bold text-base ${account.current_balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                            {formatMoney(account.current_balance)}
                          </span>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            +{formatMoney(account.current_month_in || 0)}
                          </span>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className="font-medium text-rose-600 dark:text-rose-400">
                            -{formatMoney(account.current_month_out || 0)}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/banks/${account.bank_account_id}/statement`}
                              className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-lg transition-colors hover:bg-primary/20 whitespace-nowrap"
                            >
                              كشف الحساب <ArrowLeftRight className="w-3 h-3" />
                            </Link>
                            <EditOpeningBalanceModal
                              bankAccountId={account.bank_account_id}
                              initialBalance={account.initial_balance}
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                        لا توجد حسابات مسجلة في هذا البنك
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {banks.length === 0 && (
          <div className="p-12 flex flex-col items-center justify-center text-center bg-accent/30 rounded-2xl border border-dashed gap-3">
            <Building2 className="w-12 h-12 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">لا توجد بنوك مسجلة حالياً</p>
          </div>
        )}
      </div>
    </div>
  );
}
