import Link from 'next/link';
import { ArrowRight, FolderTree } from 'lucide-react';
import { getItemCategories } from '@/lib/queries/inventory';
import { requirePageAccess } from '@/lib/require-page-access';
import { CategoriesManager } from './categories-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'فئات الأصناف' };

export default async function ItemCategoriesPage() {
  await requirePageAccess('inventory');
  const categories = await getItemCategories();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/inventory/items" className="p-2 bg-muted rounded-full hover:bg-muted/80 transition-colors">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderTree className="w-6 h-6 text-primary" />
            فئات الأصناف
          </h1>
          <p className="text-muted-foreground mt-1">
            فئات رئيسية وفرعية لتنظيم دليل الأصناف — الإدارة متاحة للمشرفين فقط
          </p>
        </div>
      </div>

      <CategoriesManager categories={categories} />
    </div>
  );
}
