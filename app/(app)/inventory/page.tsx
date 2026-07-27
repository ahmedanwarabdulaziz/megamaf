import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';
import { getInventoryStock, getItemCategories, categoryLabel } from '@/lib/queries/inventory';
import { InventoryFilters } from '@/components/inventory/inventory-filters';
import { InventoryPageHeader } from '@/components/inventory/inventory-page-header';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { requirePageAccess, canEditPage } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'المخزون' };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse_id?: string; category_id?: string; search?: string }>;
}) {
  const { profile } = await requirePageAccess('inventory');
  const canEdit = canEditPage(profile, 'inventory');
  const { warehouse_id, category_id, search } = await searchParams;
  const supabase = await createClient();

  const [{ data: warehouses }, stock, categories] = await Promise.all([
    supabase.from('warehouses').select('*, projects(name)').order('name'),
    getInventoryStock({ warehouseId: warehouse_id, categoryId: category_id, search: search }),
    getItemCategories()
  ]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <InventoryPageHeader
        title="المخزون"
        description="إدارة المستودعات، الأصناف، والأرصدة"
        action={
          canEdit ? (
            <Link href="/inventory/transfer" className="flex items-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm">
              <ArrowLeftRight className="w-4 h-4" /> تحويل مخزني
            </Link>
          ) : undefined
        }
      />

      <InventoryTabs active="balances" />

      <InventoryFilters
        warehouses={warehouses || []}
        categories={categories}
        selectedWarehouseId={warehouse_id || ''}
        selectedCategoryId={category_id || ''}
        searchQuery={search || ''}
      />

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="p-4 font-medium">المستودع</th>
              <th className="p-4 font-medium">الكود</th>
              <th className="p-4 font-medium">الصنف</th>
              <th className="p-4 font-medium">الفئة</th>
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
                <td className="p-4">
                  {s.category_name ? (
                    <span className="bg-primary/10 text-primary px-2 py-1 rounded-md text-xs whitespace-nowrap">
                      {categoryLabel(s.category_name, s.parent_category_name)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">غير مصنف</span>
                  )}
                </td>
                <td className="p-4">{s.item_unit}</td>
                <td className="p-4 font-bold text-lg" dir="ltr">{Number(s.qty_on_hand).toLocaleString()}</td>
              </tr>
            ))}
            {(!stock || stock.length === 0) && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">لا يوجد أرصدة مخزنية حالياً.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
