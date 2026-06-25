import { getExpenseCategories } from '@/lib/queries/expenses';
import { CreateCategoryModal } from '@/components/settings/create-category-modal';
import { ToggleCategoryButton } from '@/components/settings/toggle-category-button';
import { DeleteCategoryButton } from '@/components/settings/delete-category-button';

export const metadata = {
  title: 'تصنيفات المصروفات',
};

export default async function ExpenseSettingsPage() {
  const categories = await getExpenseCategories();
  
  const parents = categories.filter(c => !c.parent_id);
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">تصنيفات المصروفات</h1>
        <CreateCategoryModal categories={parents} />
      </div>

      <div className="bg-card rounded-lg border shadow-sm divide-y">
        {parents.map(parent => {
          const children = categories.filter(c => c.parent_id === parent.id);
          return (
            <div key={parent.id} className="p-4">
              <div className="flex justify-between items-center font-bold mb-2">
                <span>{parent.name}</span>
                <div className="flex items-center gap-2">
                  <DeleteCategoryButton id={parent.id} />
                  <ToggleCategoryButton id={parent.id} isActive={parent.is_active} />
                </div>
              </div>
              {children.length > 0 && (
                <div className="pl-6 space-y-2 mt-2 border-l-2 ml-2">
                  {children.map(child => (
                    <div key={child.id} className="flex justify-between items-center text-sm">
                      <span>{child.name}</span>
                      <div className="flex items-center gap-2">
                        <DeleteCategoryButton id={child.id} />
                        <ToggleCategoryButton id={child.id} isActive={child.is_active} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {parents.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">لا توجد تصنيفات</div>
        )}
      </div>
    </div>
  );
}
