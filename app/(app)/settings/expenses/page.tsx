import { getExpenseCategories } from '@/lib/queries/expenses';
import { CreateCategoryModal } from '@/components/settings/create-category-modal';
import { ToggleCategoryButton } from '@/components/settings/toggle-category-button';
import { DeleteCategoryButton } from '@/components/settings/delete-category-button';
import { CategoryScopePanel } from '@/components/settings/category-scope-panel';
import { createClient } from '@/lib/supabase/server';
import { Settings2, Tag, Building2, Globe2, FolderTree } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'تصنيفات المصروفات' };

export default async function ExpenseSettingsPage() {
  const supabase = await createClient();

  const [categories, { data: projects }] = await Promise.all([
    getExpenseCategories(),
    supabase
      .from('projects')
      .select('id, name, node_type')
      .neq('node_type', 'main_company')
      .order('name'),
  ]);

  const parents = categories.filter((c: any) => !c.parent_id);

  return (
    <div className="space-y-6 p-4 md:p-8">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
              <Settings2 className="w-6 h-6 text-primary" />
            </div>
            تصنيفات المصروفات
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            إدارة تصنيفات المصروفات وتحديد نطاق ظهورها في المشاريع
          </p>
        </div>
        <CreateCategoryModal categories={parents} />
      </div>

      {/* ── Scope legend ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
          دليل النطاقات
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border/50 font-medium">
              بدون قيود
            </span>
            <span className="text-muted-foreground">يظهر في كل المصروفات (الافتراضي)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
              <Building2 className="w-3 h-3" /> الشركة الرئيسية
            </span>
            <span className="text-muted-foreground">مصروفات بدون مشروع</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
              <Globe2 className="w-3 h-3" /> جميع المشاريع
            </span>
            <span className="text-muted-foreground">يظهر في أي مشروع</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium">
              <FolderTree className="w-3 h-3" /> مشاريع محددة
            </span>
            <span className="text-muted-foreground">مشاريع مختارة فقط</span>
          </div>
        </div>
      </div>

      {/* ── Category cards ──────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {parents.map((parent: any) => {
          const children = categories.filter((c: any) => c.parent_id === parent.id);
          const scopes: any[] = parent.scopes || [];

          // Deduplicate scope types for badge display
          const scopeTypes = [...new Set(scopes.map((s: any) => s.scope))];
          const specificCount = scopes.filter((s: any) => s.scope === 'specific_project').length;

          return (
            <div
              key={parent.id}
              className="rounded-2xl border bg-card shadow-sm overflow-hidden group"
            >
              {/* Card header */}
              <div className="flex justify-between items-center p-4 border-b border-border/50 bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    <Tag className="w-4 h-4 text-primary" />
                  </div>
                  <span className="font-bold text-base">{parent.name}</span>
                  {children.length > 0 && (
                    <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium border border-border/40">
                      {children.length} فرعي
                    </span>
                  )}
                  {/* Scope badges */}
                  {scopeTypes.length === 0 && (
                    <span className="text-[10px] bg-muted/60 text-muted-foreground/70 px-2 py-0.5 rounded-full">
                      بدون قيود
                    </span>
                  )}
                  {scopeTypes.includes('main_company') && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold inline-flex items-center gap-1">
                      <Building2 className="w-2.5 h-2.5" /> الشركة
                    </span>
                  )}
                  {scopeTypes.includes('all_projects') && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-semibold inline-flex items-center gap-1">
                      <Globe2 className="w-2.5 h-2.5" /> جميع المشاريع
                    </span>
                  )}
                  {scopeTypes.includes('specific_project') && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-semibold inline-flex items-center gap-1">
                      <FolderTree className="w-2.5 h-2.5" /> {specificCount} مشروع
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <DeleteCategoryButton id={parent.id} />
                  <ToggleCategoryButton id={parent.id} isActive={parent.is_active} />
                </div>
              </div>

              {/* Children */}
              {children.length > 0 && (
                <div className="px-6 py-3 space-y-2 bg-muted/20 border-b border-border/30">
                  {children.map((child: any) => (
                    <div key={child.id} className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="text-border">└</span>
                        <span>{child.name}</span>
                        {!child.is_active && (
                          <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                            معطّل
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <DeleteCategoryButton id={child.id} />
                        <ToggleCategoryButton id={child.id} isActive={child.is_active} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Scope Panel — always visible, editable */}
              <CategoryScopePanel
                categoryId={parent.id}
                initialScopes={scopes}
                projects={projects || []}
              />
            </div>
          );
        })}

        {parents.length === 0 && (
          <div className="p-16 flex flex-col items-center justify-center text-center bg-accent/20 rounded-2xl border border-dashed gap-4">
            <div className="p-4 rounded-2xl bg-muted">
              <Tag className="w-10 h-10 text-muted-foreground/40" />
            </div>
            <div>
              <p className="text-lg font-semibold text-muted-foreground">لا توجد تصنيفات مسجلة</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                ابدأ بإضافة تصنيف جديد لتنظيم مصروفاتك
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
