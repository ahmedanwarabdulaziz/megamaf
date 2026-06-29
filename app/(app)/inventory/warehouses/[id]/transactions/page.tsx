import { getWarehouse, getWarehouseTransactions } from '@/lib/queries/inventory';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, PackageOpen, ArrowUpRight, ArrowDownRight, User } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export const metadata = { title: 'حركة المستودع' };

export default async function WarehouseTransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const warehouse = await getWarehouse(id);
  if (!warehouse) notFound();

  const transactions = await getWarehouseTransactions(id);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/inventory/warehouses" className="p-2 bg-muted rounded-full hover:bg-muted/80 transition-colors">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageOpen className="w-6 h-6 text-primary" />
            حركة المستودع: {warehouse.name}
          </h1>
          <p className="text-muted-foreground mt-1">
            {warehouse.projects?.name ? `مشروع: ${warehouse.projects.name}` : 'مستودع رئيسي'}
          </p>
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-4 font-medium">التاريخ</th>
                <th className="p-4 font-medium">نوع الحركة</th>
                <th className="p-4 font-medium">الصنف</th>
                <th className="p-4 font-medium text-center">الكمية</th>
                <th className="p-4 font-medium">القيمة / السعر</th>
                <th className="p-4 font-medium">بواسطة</th>
                <th className="p-4 font-medium">ملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactions?.map((t: any) => {
                const isOut = Number(t.qty) < 0;
                return (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-4 text-muted-foreground whitespace-nowrap" dir="ltr">
                      {new Date(t.created_at).toLocaleString('en-GB')}
                    </td>
                    <td className="p-4 font-medium">
                      <div className="flex items-center gap-1.5">
                        {isOut ? <ArrowUpRight className="w-4 h-4 text-destructive" /> : <ArrowDownRight className="w-4 h-4 text-green-500" />}
                        {t.movement_type === 'in_invoice' ? 'شراء (فاتورة)' : 
                         t.movement_type === 'transfer_in' ? 'تحويل وارد' : 
                         t.movement_type === 'transfer_out' ? 'تحويل صادر' : 
                         t.movement_type === 'opening_balance' ? 'رصيد افتتاحي' : 
                         t.movement_type === 'issue' ? (
                           t.claim ? (
                             <Link
                               href={`/claims/${t.claim.id}`}
                               className="text-destructive hover:underline font-semibold"
                             >
                               صرف — مستخلص #{t.claim.claim_number}
                               {t.claim.party_name && (
                                 <span className="text-xs font-normal text-muted-foreground mr-1">
                                   ({t.claim.party_name})
                                 </span>
                               )}
                             </Link>
                           ) : 'صرف لمشروع'
                         ) : 'تسوية'}
                      </div>
                    </td>
                    <td className="p-4 font-semibold">
                      {t.inventory_items?.name} <span className="text-xs text-muted-foreground font-normal">({t.inventory_items?.code})</span>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`font-bold px-2 py-1 rounded-md ${isOut ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`} dir="ltr">
                        {isOut ? '' : '+'}{Number(t.qty).toLocaleString()} {t.inventory_items?.unit}
                      </span>
                    </td>
                    <td className="p-4">
                      {t.unit_price ? formatMoney(t.unit_price) : '-'}
                    </td>
                    <td className="p-4 text-muted-foreground flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {t.employees?.full_name || '-'}
                    </td>
                    <td className="p-4 text-muted-foreground text-xs max-w-[200px] truncate" title={t.notes}>
                      {t.notes || '-'}
                    </td>
                  </tr>
                );
              })}
              {(!transactions || transactions.length === 0) && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">لا يوجد حركات لهذا المستودع.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
