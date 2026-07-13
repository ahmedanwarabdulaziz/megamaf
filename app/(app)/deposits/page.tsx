import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Wallet, Plus, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { requirePageAccess } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'الودائع والشهادات' };

const STATUS_LABEL: Record<string, string> = {
  returned: 'تم إرجاعها للبنك',
  renewed: 'تم تجديدها',
};

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePageAccess('deposits');
  const { tab = 'active' } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('deposits')
    .select(`
      *,
      deposit_payouts ( expected_amount, collected_amount, is_collected )
    `)
    .order('created_at', { ascending: false });

  query = tab === 'old' ? query.neq('status', 'active') : query.eq('status', 'active');

  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const todayStr = todayUTC.toISOString().split('T')[0];
  const threeMonthsOutUTC = new Date(todayUTC);
  threeMonthsOutUTC.setUTCMonth(threeMonthsOutUTC.getUTCMonth() + 3);

  const monthStartStr = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1)).toISOString().split('T')[0];
  const monthEndStr = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, 1)).toISOString().split('T')[0];

  const [{ data: deposits }, { data: monthPayouts }] = await Promise.all([
    query,
    supabase
      .from('deposit_payouts')
      .select('expected_amount, collected_amount, is_collected, due_date, deposits(id, name)')
      .gte('due_date', monthStartStr)
      .lt('due_date', monthEndStr),
  ]);

  function groupBySource(rows: any[], amountKey: 'collected_amount' | 'expected_amount') {
    const byDeposit = new Map<string, { id: string; name: string; amount: number }>();
    for (const r of rows) {
      const id = r.deposits?.id || 'unknown';
      const name = r.deposits?.name || '—';
      const existing = byDeposit.get(id);
      const amount = Number(r[amountKey] ?? 0);
      if (existing) existing.amount += amount;
      else byDeposit.set(id, { id, name, amount });
    }
    return Array.from(byDeposit.values()).sort((a, b) => b.amount - a.amount);
  }

  const collectedRows = monthPayouts?.filter(p => p.is_collected) || [];
  const overdueRows = monthPayouts?.filter(p => !p.is_collected && p.due_date <= todayStr) || [];
  const upcomingRows = monthPayouts?.filter(p => !p.is_collected && p.due_date > todayStr) || [];

  const totalThisMonth = monthPayouts?.reduce((sum, p) => sum + Number(p.expected_amount), 0) || 0;
  const collectedThisMonth = collectedRows.reduce((sum, p) => sum + Number(p.collected_amount), 0);
  const overdueThisMonth = overdueRows.reduce((sum, p) => sum + Number(p.expected_amount), 0);
  const upcomingThisMonth = upcomingRows.reduce((sum, p) => sum + Number(p.expected_amount), 0);

  const collectedSources = groupBySource(collectedRows, 'collected_amount');
  const overdueSources = groupBySource(overdueRows, 'expected_amount');
  const upcomingSources = groupBySource(upcomingRows, 'expected_amount');

  const totalDepositsAmount = deposits?.reduce((sum, d) => sum + Number(d.principal_amount), 0) || 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between bg-card p-6 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-full">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">الودائع والشهادات</h1>
            <p className="text-muted-foreground mt-1">إدارة الشهادات البنكية وحساب العوائد</p>
          </div>
        </div>
        <Link href="/deposits/create" className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> إصدار شهادة/وديعة
        </Link>
      </div>

      <div className="bg-card rounded-lg border shadow-sm p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              إجمالي الودائع ({tab === 'old' ? 'القديمة' : 'الحالية'})
            </p>
            <p className="text-3xl font-bold">{formatMoney(totalDepositsAmount)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">إجمالي العوائد المستحقة هذا الشهر</p>
            <p className="text-3xl font-bold text-primary">{formatMoney(totalThisMonth)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-4 pt-4 border-t">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10 text-green-600 shrink-0">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">تم تحصيله</p>
                <p className="font-bold text-green-600 truncate">{formatMoney(collectedThisMonth)}</p>
              </div>
            </div>
            {collectedSources.length > 0 && (
              <ul className="mt-2 space-y-1">
                {collectedSources.map(s => (
                  <li key={s.id} className="text-xs text-muted-foreground flex justify-between gap-2">
                    <Link href={`/deposits/${s.id}`} className="truncate hover:text-primary hover:underline">{s.name}</Link>
                    <span className="shrink-0 font-medium">{formatMoney(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">مستحق (فات موعده ولم يُحصّل)</p>
                <p className="font-bold text-amber-600 truncate">{formatMoney(overdueThisMonth)}</p>
              </div>
            </div>
            {overdueSources.length > 0 && (
              <ul className="mt-2 space-y-1">
                {overdueSources.map(s => (
                  <li key={s.id} className="text-xs text-muted-foreground flex justify-between gap-2">
                    <Link href={`/deposits/${s.id}`} className="truncate hover:text-primary hover:underline">{s.name}</Link>
                    <span className="shrink-0 font-medium">{formatMoney(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">قادم لاحقاً هذا الشهر</p>
                <p className="font-bold text-blue-600 truncate">{formatMoney(upcomingThisMonth)}</p>
              </div>
            </div>
            {upcomingSources.length > 0 && (
              <ul className="mt-2 space-y-1">
                {upcomingSources.map(s => (
                  <li key={s.id} className="text-xs text-muted-foreground flex justify-between gap-2">
                    <Link href={`/deposits/${s.id}`} className="truncate hover:text-primary hover:underline">{s.name}</Link>
                    <span className="shrink-0 font-medium">{formatMoney(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto pb-1">
        <a
          href="?tab=active"
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            tab === 'active'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          الودائع الحالية
        </a>
        <a
          href="?tab=old"
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            tab === 'old'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          الودائع القديمة
        </a>
      </div>

      {tab === 'active' && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-200 dark:bg-red-900/50" /> منتهية بالفعل</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-yellow-200 dark:bg-yellow-900/50" /> تنتهي هذا الشهر</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-200 dark:bg-orange-900/50" /> تنتهي خلال 3 أشهر</span>
        </div>
      )}

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">الاسم</th>
                <th className="p-3 font-medium">البنك</th>
                <th className="p-3 font-medium">أصل المبلغ</th>
                <th className="p-3 font-medium">العائد المتوقع</th>
                <th className="p-3 font-medium">العائد المحصل</th>
                <th className="p-3 font-medium">المدة</th>
                <th className="p-3 font-medium">نوع العائد</th>
                <th className="p-3 font-medium">تاريخ الإصدار</th>
                <th className="p-3 font-medium">تاريخ الاستحقاق</th>
                {tab === 'old' && <th className="p-3 font-medium">الحالة</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deposits?.map(d => {
                const totalExpected = d.deposit_payouts?.reduce((sum: number, p: any) => sum + Number(p.expected_amount), 0) || 0;
                const totalCollected = d.deposit_payouts?.reduce((sum: number, p: any) => sum + (p.is_collected ? Number(p.collected_amount) : 0), 0) || 0;
                const expiryDate = new Date(d.start_date + 'T00:00:00Z');
                expiryDate.setUTCMonth(expiryDate.getUTCMonth() + d.term_months);

                const isExpired = tab === 'active' && expiryDate < todayUTC;
                const isExpiringThisMonth = tab === 'active' && !isExpired
                  && expiryDate.getUTCFullYear() === todayUTC.getUTCFullYear()
                  && expiryDate.getUTCMonth() === todayUTC.getUTCMonth();
                const isExpiringSoon = tab === 'active' && !isExpired && !isExpiringThisMonth && expiryDate <= threeMonthsOutUTC;

                const rowHighlight = isExpired
                  ? 'bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/40'
                  : isExpiringThisMonth
                    ? 'bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-900/40'
                    : isExpiringSoon
                      ? 'bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                      : 'hover:bg-muted/30';

                return (
                  <tr key={d.id} className={`transition-colors cursor-pointer ${rowHighlight}`}>
                    <td className="p-0">
                      <Link href={`/deposits/${d.id}`} className="block p-3 font-bold">{d.name}</Link>
                    </td>
                    <td className="p-3 text-muted-foreground">{d.bank_name}</td>
                    <td className="p-3 font-semibold">{formatMoney(d.principal_amount)}</td>
                    <td className="p-3 font-semibold text-primary">{formatMoney(totalExpected)}</td>
                    <td className="p-3 font-semibold text-green-600">{formatMoney(totalCollected)}</td>
                    <td className="p-3 whitespace-nowrap">{d.term_months} شهر</td>
                    <td className="p-3 whitespace-nowrap">
                      {d.profit_type === 'annual_rate' ? `سنوي ${d.profit_value}%` : 'مبلغ ثابت'}
                    </td>
                    <td className="p-3 whitespace-nowrap">{new Date(d.start_date).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</td>
                    <td className="p-3 whitespace-nowrap">{expiryDate.toLocaleDateString('en-GB', { timeZone: 'UTC' })}</td>
                    {tab === 'old' && (
                      <td className="p-3">
                        <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full whitespace-nowrap">
                          {STATUS_LABEL[d.status]}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}

              {(!deposits || deposits.length === 0) && (
                <tr>
                  <td colSpan={tab === 'old' ? 10 : 9} className="p-12 text-center">
                    <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium text-muted-foreground">
                      {tab === 'old' ? 'لا يوجد ودائع قديمة (مُرجعة أو مُجدَّدة) بعد' : 'لا يوجد ودائع أو شهادات حالياً'}
                    </h3>
                    {tab === 'active' && (
                      <p className="text-sm text-muted-foreground mt-2">قم بإنشاء وديعة جديدة لإدارة أرباحها.</p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
