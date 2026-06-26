import { createClient } from '@/lib/supabase/server';
import { ItemForm } from './item-form';
import Link from 'next/link';

export const metadata = { title: 'إدارة الأصناف' };

export default async function ItemsPage() {
  const supabase = await createClient();
  const { data: items } = await supabase.from('inventory_items').select('*').order('name');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">دليل الأصناف</h1>
          <p className="text-muted-foreground mt-1">إضافة وإدارة المواد المخزنية</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <ItemForm />
        </div>
        <div className="md:col-span-2 bg-card rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">الكود</th>
                <th className="p-3 font-medium">الصنف</th>
                <th className="p-3 font-medium">الوحدة</th>
                <th className="p-3 font-medium text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items?.map(item => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="p-3 font-medium text-muted-foreground">{item.code}</td>
                  <td className="p-3 font-bold">{item.name}</td>
                  <td className="p-3">{item.unit}</td>
                  <td className="p-3 text-center">
                    <Link href={`/inventory/items/${item.id}/transactions`} className="text-xs bg-muted hover:bg-muted/80 text-foreground px-3 py-1.5 rounded border transition-colors inline-block">
                      حركة الصنف
                    </Link>
                  </td>
                </tr>
              ))}
              {(!items || items.length === 0) && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">لم يتم إضافة أصناف بعد.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
