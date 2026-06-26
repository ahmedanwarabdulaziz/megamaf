import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import { CollectModal } from '@/components/deposits/collect-modal';

export const metadata = { title: 'تفاصيل الشهادة/الوديعة' };

export default async function DepositDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: deposit } = await supabase
    .from('deposits')
    .select(`
      *,
      deposit_payouts (*),
      bank_accounts!deposits_default_bank_account_id_fkey(account_name, banks(name))
    `)
    .eq('id', id)
    .single();

  if (!deposit) notFound();

  const { data: bankAccounts } = await supabase.from('v_bank_account_balances').select('*').order('account_name');

  const payouts = deposit.deposit_payouts?.sort((a: any, b: any) => a.seq - b.seq) || [];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">{deposit.name}</h1>
        <p className="text-muted-foreground mt-1">{deposit.bank_name}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
          <div className="bg-card p-4 rounded-lg border shadow-sm space-y-3 text-sm">
            <h3 className="font-bold border-b pb-2">تفاصيل العقد</h3>
            <div className="flex justify-between">
              <span className="text-muted-foreground">أصل المبلغ:</span>
              <span className="font-bold">{formatMoney(deposit.principal_amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">تاريخ الإصدار:</span>
              <span className="font-medium">{new Date(deposit.start_date).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">المدة:</span>
              <span className="font-medium">{deposit.term_months} شهر</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">العائد:</span>
              <span className="font-medium text-primary">
                {deposit.profit_type === 'annual_rate' ? `${deposit.profit_value}% سنوياً` : formatMoney(deposit.profit_value)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">دورية الصرف:</span>
              <span className="font-medium">
                {deposit.payout_frequency === 'monthly' && 'شهري'}
                {deposit.payout_frequency === 'quarterly' && 'ربع سنوي'}
                {deposit.payout_frequency === 'semiannual' && 'نصف سنوي'}
                {deposit.payout_frequency === 'annual' && 'سنوي'}
                {deposit.payout_frequency === 'at_maturity' && 'نهاية المدة'}
              </span>
            </div>
            {deposit.default_bank_account_id && (
              <div className="flex justify-between flex-col gap-1 mt-2">
                <span className="text-muted-foreground">الحساب الافتراضي:</span>
                <span className="font-medium text-xs bg-muted p-1.5 rounded">{deposit.bank_accounts?.banks?.name} - {deposit.bank_accounts?.account_name}</span>
              </div>
            )}
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/30">
              <h3 className="font-bold">جدول العوائد (الاستحقاقات)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="p-3 font-medium">م</th>
                    <th className="p-3 font-medium">تاريخ الاستحقاق</th>
                    <th className="p-3 font-medium">المبلغ المتوقع</th>
                    <th className="p-3 font-medium">الحالة</th>
                    <th className="p-3 font-medium">تاريخ التحصيل</th>
                    <th className="p-3 font-medium">المبلغ المحصل</th>
                    <th className="p-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(() => {
                    const WINDOW_DAYS = 15;
                    const todayUTC = new Date();
                    todayUTC.setUTCHours(0, 0, 0, 0);

                    // Lower bound: today minus 15 days
                    const lowerBound = new Date(todayUTC);
                    lowerBound.setUTCDate(lowerBound.getUTCDate() - WINDOW_DAYS);

                    // Upper bound: today plus 15 days
                    const upperBound = new Date(todayUTC);
                    upperBound.setUTCDate(upperBound.getUTCDate() + WINDOW_DAYS);

                    return payouts.map((p: any) => {
                      const dueDate = new Date(p.due_date + 'T00:00:00Z');
                      const isTooOld   = dueDate < lowerBound;   // past the 15-day grace window
                      const isTooEarly = dueDate > upperBound;    // more than 15 days in the future
                      // Only lock OLD payouts — future ones stay unlocked so they can be collected early
                      const isOutOfWindow = isTooOld;

                      return (
                        <tr key={p.id} className={`hover:bg-muted/30 ${isOutOfWindow && !p.is_collected ? 'opacity-40' : ''}`}>
                          <td className="p-3 font-medium">{p.seq}</td>
                          <td className="p-3">{new Date(p.due_date).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</td>
                          <td className="p-3 font-semibold text-primary">{formatMoney(p.expected_amount)}</td>
                          <td className="p-3">
                            {p.is_collected ? (
                              <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded text-xs font-medium">مُحصّل</span>
                            ) : isTooOld ? (
                              <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-1 rounded text-xs font-medium">منتهية المهلة</span>
                            ) : isTooEarly ? (
                              <span className="bg-muted text-muted-foreground px-2 py-1 rounded text-xs font-medium">لم يحن بعد</span>
                            ) : (
                              <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded text-xs font-medium">منتظر</span>
                            )}
                          </td>
                          <td className="p-3">{p.collected_date ? new Date(p.collected_date).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : '-'}</td>
                          <td className="p-3 font-bold text-green-600">{p.is_collected ? formatMoney(p.collected_amount) : '-'}</td>
                          <td className="p-3 text-left">
                            {!p.is_collected && !isTooOld && (
                              <CollectModal
                                payout={p}
                                bankAccounts={bankAccounts || []}
                                defaultBankAccountId={deposit.default_bank_account_id}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
