import { getAllCustodyBalances, getAllOwnerCustodyBalances } from '@/lib/queries/expenses';
import { getBanks } from '@/lib/queries/banks';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
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
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          {balances.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">لا يوجد موظفين لديهم صلاحية العهد</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 text-right font-medium">الموظف</th>
                  <th className="p-3 text-right font-medium">إجمالي المنصرف</th>
                  <th className="p-3 text-right font-medium">العهد المسواة</th>
                  <th className="p-3 text-right font-medium">المصروفات المعتمدة</th>
                  <th className="p-3 text-right font-medium">الرصيد المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {balances.map((b: any) => (
                  <tr key={b.employee_id} className="hover:bg-muted/20 transition-colors">
                    <td className="p-3 font-medium">{b.full_name}</td>
                    <td className="p-3">{formatMoney(b.total_disbursed)}</td>
                    <td className="p-3">{formatMoney(b.total_settled)}</td>
                    <td className="p-3">{formatMoney(b.total_approved_expenses)}</td>
                    <td className={`p-3 font-bold ${b.balance < 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {formatMoney(b.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Owner custody tab */}
      {tab === 'owners' && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          {ownerBalances.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p className="text-base">لا يوجد ملاك لديهم عهد مفتوحة</p>
              <p className="text-sm mt-1">استخدم الزر في الأعلى لبدء صرف عهدة لمالك</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 text-right font-medium">المالك</th>
                  <th className="p-3 text-right font-medium">إجمالي المنصرف</th>
                  <th className="p-3 text-right font-medium">المصروفات المعتمدة</th>
                  <th className="p-3 text-right font-medium">الرصيد المتبقي</th>
                  <th className="p-3 text-center font-medium">الكشف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ownerBalances.map((b: any) => (
                  <tr key={b.owner_id} className="hover:bg-muted/20 transition-colors">
                    <td className="p-3 font-medium">{b.name}</td>
                    <td className="p-3">{formatMoney(b.total_disbursed)}</td>
                    <td className="p-3">{formatMoney(b.total_approved_expenses)}</td>
                    <td className={`p-3 font-bold ${b.balance < 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {formatMoney(b.balance)}
                    </td>
                    <td className="p-3 text-center">
                      <Link
                        href={`/settings/owners/${b.owner_id}/statement`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-primary hover:bg-primary/10 transition-colors"
                        title="كشف الحساب"
                      >
                        <ClipboardList className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
