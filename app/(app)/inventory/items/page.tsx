import { ItemForm } from './item-form';
import { ItemsFilters } from './items-filters';
import { ItemRowActions } from './item-row-actions';
import Link from 'next/link';
import { FolderTree } from 'lucide-react';
import { getInventoryItemsWithCategory, getItemCategories } from '@/lib/queries/inventory';
import { InventoryPageHeader } from '@/components/inventory/inventory-page-header';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { requirePageAccess, canEditPage } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إدارة الأصناف' };

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ category_id?: string; search?: string }>;
}) {
  const { profile } = await requirePageAccess('inventory');
  const canEdit = canEditPage(profile, 'inventory');
  const { category_id, search } = await searchParams;
  const [allItems, categories] = await Promise.all([
    getInventoryItemsWithCategory(),
    getItemCategories(),
  ]);

  // Matches the sub-category directly, or every sub when a main category is chosen
  let items = category_id
    ? allItems.filter(i => i.category_id === category_id || i.parent_category_id === category_id)
    : allItems;

  if (search) {
    const q = search.trim().toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q) || i.code?.toLowerCase().includes(q));
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <InventoryPageHeader
        title="دليل الأصناف"
        description="إضافة وإدارة المواد المخزنية"
        action={
          <>
            <Link href="/inventory/categories" className="flex items-center gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md font-medium text-sm">
              <FolderTree className="w-4 h-4" /> إدارة الفئات
            </Link>
            {canEdit && <ItemForm categories={categories} />}
          </>
        }
      />

      <InventoryTabs active="items" />

      <ItemsFilters categories={categories} selectedCategoryId={category_id || ''} searchQuery={search || ''} />

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="p-3 font-medium">الكود</th>
              <th className="p-3 font-medium">الصنف</th>
              <th className="p-3 font-medium">الفئة</th>
              <th className="p-3 font-medium">الوحدة</th>
              <th className="p-3 font-medium text-center">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items?.map(item => (
              <tr key={item.id} className="hover:bg-muted/30">
                <td className="p-3 font-medium text-muted-foreground">{item.code}</td>
                <td className="p-3 font-bold">{item.name}</td>
                <td className="p-3">
                  {item.category_label ? (
                    <span className="bg-primary/10 text-primary px-2 py-1 rounded-md text-xs">{item.category_label}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs">غير مصنف</span>
                  )}
                </td>
                <td className="p-3">{item.unit}</td>
                <td className="p-3">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <Link href={`/inventory/items/${item.id}/transactions`} className="text-xs bg-muted hover:bg-muted/80 text-foreground px-3 py-1.5 rounded border transition-colors inline-block">
                      حركة الصنف
                    </Link>
                    {canEdit && <ItemRowActions item={item} categories={categories} />}
                  </div>
                </td>
              </tr>
            ))}
            {(!items || items.length === 0) && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  {category_id || search ? 'لا توجد أصناف مطابقة لبحثك.' : 'لم يتم إضافة أصناف بعد.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
