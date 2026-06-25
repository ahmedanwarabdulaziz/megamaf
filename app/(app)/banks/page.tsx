import { getBanks } from '@/lib/queries/banks';
import { Card } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { CreateBankModal } from '@/components/banks/create-bank-modal';
import { CreateAccountModal } from '@/components/banks/create-account-modal';
import { Building2, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Landmark } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export const dynamic = 'force-dynamic';

export default async function BanksPage() {
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
          <CreateBankModal />
          {banks.length > 0 && <CreateAccountModal banks={banks} />}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {banks.map((bank) => (
          <div key={bank.id} className="col-span-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-xl font-bold">{bank.name}</h2>
            </div>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bank.accounts?.length > 0 ? (
                bank.accounts.map((account: any) => (
                  <div key={account.bank_account_id} className="group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-blue-500/5 to-indigo-500/5 shadow-sm transition-all hover:shadow-md border-border/60">
                    <div className="absolute inset-0 bg-background/60 backdrop-blur-xl -z-10" />
                    
                    {/* Header */}
                    <div className="p-5 border-b border-border/50">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-lg">{account.account_name}</h3>
                          <p className="text-sm text-muted-foreground mt-0.5" dir="ltr">{account.account_number}</p>
                          <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-muted border font-semibold text-muted-foreground">
                            {account.currency}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="p-5 bg-background/40">
                      <p className="text-xs text-muted-foreground mb-1">الرصيد الحالي</p>
                      <p className={`text-2xl font-black ${account.current_balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                        {formatMoney(account.current_balance)}
                      </p>
                    </div>

                    {/* Current Month Stats */}
                    <div className="grid grid-cols-2 gap-px bg-border/50 border-t border-border/50">
                      <div className="bg-background/80 p-4 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" /> إيداعات الشهر
                        </div>
                        <p className="font-bold text-emerald-600 dark:text-emerald-400">
                          +{formatMoney(account.current_month_in || 0)}
                        </p>
                      </div>
                      <div className="bg-background/80 p-4 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" /> سحوبات الشهر
                        </div>
                        <p className="font-bold text-rose-600 dark:text-rose-400">
                          -{formatMoney(account.current_month_out || 0)}
                        </p>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-3 bg-muted/30 border-t border-border/50 flex justify-end">
                      <Link 
                        href={`/banks/${account.bank_account_id}/statement`}
                        className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-lg transition-colors hover:bg-primary/20"
                      >
                        كشف الحساب <ArrowLeftRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full p-6 text-sm text-muted-foreground border rounded-xl bg-card text-center">
                  لا توجد حسابات مسجلة في هذا البنك
                </div>
              )}
            </div>
          </div>
        ))}
        
        {banks.length === 0 && (
          <div className="col-span-full p-12 flex flex-col items-center justify-center text-center bg-accent/30 rounded-2xl border border-dashed gap-3">
            <Building2 className="w-12 h-12 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">لا توجد بنوك مسجلة حالياً</p>
          </div>
        )}
      </div>
    </div>
  );
}
