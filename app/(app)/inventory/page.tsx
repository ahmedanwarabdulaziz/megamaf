import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Package } from 'lucide-react';

export const metadata = { title: 'المخزون' };

export default async function InventoryPage() {
  const supabase = await createClient();

  const { data: stock } = await supabase
    .from('v_stock_on_hand')
    .select('*')
    .order('warehouse_name')
    .order('item_name');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between bg-card p-6 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-full">
            <Package className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">المخزون</h1>
            <p className="text-muted-foreground mt-1">إدارة المستودعات، الأصناف، والأرصدة</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/items" className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md font-medium text-sm">
            الأصناف
          </Link>
          <Link href="/inventory/warehouses" className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md font-medium text-sm">
            المستودعات
          </Link>
          <Link href="/inventory/transfer" className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm">
            تحويل مخزني
          </Link>
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="p-4 font-medium">المستودع</th>
              <th className="p-4 font-medium">الكود</th>
              <th className="p-4 font-medium">الصنف</th>
              <th className="p-4 font-medium">الوحدة</th>
              <th className="p-4 font-medium text-primary">الرصيد المتاح</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {stock?.map((s, idx) => (
              <tr key={`${s.warehouse_id}_${s.item_id}_${idx}`} className="hover:bg-muted/30 transition-colors">
                <td className="p-4 font-semibold">{s.warehouse_name}</td>
                <td className="p-4 text-muted-foreground">{s.item_code}</td>
                <td className="p-4 font-medium">{s.item_name}</td>
                <td className="p-4">{s.item_unit}</td>
                <td className="p-4 font-bold text-lg" dir="ltr">{Number(s.qty_on_hand).toLocaleString()}</td>
              </tr>
            ))}
            {(!stock || stock.length === 0) && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">لا يوجد أرصدة مخزنية حالياً.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
