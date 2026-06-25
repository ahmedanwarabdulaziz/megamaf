import { getAllCustodyBalances, getAllOwnerCustodyBalances } from '@/lib/queries/expenses';
import { getBanks } from '@/lib/queries/banks';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { DisburseCustodyModal } from '@/components/treasury/disburse-custody-modal';
import { DisburseOwnerCustodyModal } from '@/components/treasury/disburse-owner-custody-modal';

export const metadata = {
  title: 'صرف العهد',
};

export default async function TreasuryCustodyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = 'employees' } = await searchParams;
  const supabase = await createClient();

  const [balances, ownerBalances, banks] = await Promise.all([
    getAllCustodyBalances(),
    getAllOwnerCustodyBalances(),
    getBanks(),
  ]);

  // All owners for the disburse modal
  const { data: owners } = await supabase
    .from('project_owners')
    .select('id, name')
    .order('name');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">صرف العهد</h1>
        <div className="flex gap-2">
          {tab === 'employees' && (
            <DisburseCustodyModal employees={balances} banks={banks} />
          )}
          {tab === 'owners' && (
            <DisburseOwnerCustodyModal owners={owners || []} banks={banks} />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <a
          href="?tab=employees"
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'employees'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          👷 الموظفون
        </a>
        <a
          href="?tab=owners"
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'owners'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          🏢 الملاك
        </a>
      </div>

      {/* Employee custody tab */}
      {tab === 'employees' && (
        <div className="bg-card rounded-lg border shadow-sm divide-y divide-border">
          {balances.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">لا يوجد موظفين لديهم صلاحية العهد</div>
          ) : (
            balances.map((b: any) => (
              <div key={b.employee_id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-muted/20 transition-colors">
                <div>
                  <p className="font-bold">{b.full_name}</p>
                  <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-4">
                    <span>إجمالي المنصرف: <span className="font-medium text-foreground">{formatMoney(b.total_disbursed)}</span></span>
                    <span>العهد المسواة: <span className="font-medium text-foreground">{formatMoney(b.total_settled)}</span></span>
                    <span>المصروفات المعتمدة: <span className="font-medium text-foreground">{formatMoney(b.total_approved_expenses)}</span></span>
                  </div>
                </div>
                <div className="text-left flex flex-col sm:items-end">
                  <p className="text-xs text-muted-foreground mb-1">الرصيد المتبقي</p>
                  <div className={`text-xl font-bold whitespace-nowrap ${b.balance < 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {formatMoney(b.balance)}
                  </div>
                  <Link href={`/reports/employee-custody?employee_id=${b.employee_id}`} className="mt-2 text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-lg transition-colors hover:bg-primary/20">
                    التفاصيل / كشف العهدة
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Owner custody tab */}
      {tab === 'owners' && (
        <div className="bg-card rounded-lg border shadow-sm divide-y divide-border">
          {ownerBalances.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p className="text-base">لا يوجد ملاك لديهم عهد مفتوحة</p>
              <p className="text-sm mt-1">استخدم الزر في الأعلى لبدء صرف عهدة لمالك</p>
            </div>
          ) : (
            ownerBalances.map((b: any) => (
              <div key={b.owner_id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-muted/20 transition-colors">
                <div>
                  <p className="font-bold">{b.name}</p>
                  <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-4">
                    <span>إجمالي المنصرف: <span className="font-medium text-foreground">{formatMoney(b.total_disbursed)}</span></span>
                    <span>المصروفات المعتمدة: <span className="font-medium text-foreground">{formatMoney(b.total_approved_expenses)}</span></span>
                  </div>
                </div>
                <div className="text-left flex flex-col sm:items-end">
                  <p className="text-xs text-muted-foreground mb-1">الرصيد المتبقي</p>
                  <div className={`text-xl font-bold whitespace-nowrap ${b.balance < 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {formatMoney(b.balance)}
                  </div>
                  <Link href={`/settings/owners/${b.owner_id}/statement`} className="mt-2 text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-lg transition-colors hover:bg-primary/20">
                    التفاصيل / كشف الحساب
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
