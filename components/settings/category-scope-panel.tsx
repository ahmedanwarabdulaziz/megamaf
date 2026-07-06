'use client';

import { useState, useTransition } from 'react';
import { Building2, Globe2, FolderTree, Check, Loader2, Info } from 'lucide-react';
import { updateCategoryScopes } from '@/lib/actions/categories';

interface ScopeEntry {
  scope: 'main_company' | 'all_projects' | 'specific_project';
  project_id?: string | null;
}

interface Project {
  id: string;
  name: string;
  node_type: string;
}

export function CategoryScopePanel({
  categoryId,
  initialScopes,
  projects,
}: {
  categoryId: string;
  initialScopes: ScopeEntry[];
  projects: Project[];
}) {
  const [isPending, startTransition] = useTransition();
  const [savedOk, setSavedOk] = useState(false);

  // Derive initial toggle states from scope entries
  const [isMainCompany, setIsMainCompany] = useState(() =>
    initialScopes.some(s => s.scope === 'main_company')
  );
  const [isAllProjects, setIsAllProjects] = useState(() =>
    initialScopes.some(s => s.scope === 'all_projects')
  );
  const [showSpecific, setShowSpecific] = useState(() =>
    initialScopes.some(s => s.scope === 'specific_project')
  );
  const [specificProjectIds, setSpecificProjectIds] = useState<Set<string>>(() =>
    new Set(
      initialScopes
        .filter(s => s.scope === 'specific_project' && s.project_id)
        .map(s => s.project_id!)
    )
  );

  const noRestrictions = !isMainCompany && !isAllProjects && !showSpecific;

  function handleSave() {
    const scopes: Array<{ scope: string; project_id?: string }> = [];
    if (isMainCompany) scopes.push({ scope: 'main_company' });
    if (isAllProjects) scopes.push({ scope: 'all_projects' });
    if (showSpecific) {
      specificProjectIds.forEach(pid =>
        scopes.push({ scope: 'specific_project', project_id: pid })
      );
    }

    startTransition(async () => {
      try {
        await updateCategoryScopes(categoryId, scopes as any);
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 3000);
      } catch (e: any) {
        alert(e.message || 'حدث خطأ أثناء الحفظ');
      }
    });
  }

  function toggleSpecific() {
    if (showSpecific) {
      setShowSpecific(false);
      setSpecificProjectIds(new Set());
    } else {
      setShowSpecific(true);
    }
  }

  function toggleProject(id: string, checked: boolean) {
    const next = new Set(specificProjectIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSpecificProjectIds(next);
  }

  return (
    <div className="px-4 pb-4 pt-3 border-t border-border/40 bg-muted/5">
      {/* Section title */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-semibold tracking-widest text-muted-foreground/70 uppercase">
          نطاق الظهور
        </span>
        {noRestrictions && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            <Info className="w-2.5 h-2.5" />
            بدون قيود — يظهر في جميع المصروفات
          </span>
        )}
      </div>

      {/* Scope toggle pills */}
      <div className="flex flex-wrap gap-2 mb-3">
        <ScopePill
          active={isMainCompany}
          label="الشركة الرئيسية"
          color="blue"
          icon={<Building2 className="w-3.5 h-3.5" />}
          onClick={() => setIsMainCompany(v => !v)}
        />
        <ScopePill
          active={isAllProjects}
          label="جميع المشاريع"
          color="emerald"
          icon={<Globe2 className="w-3.5 h-3.5" />}
          onClick={() => setIsAllProjects(v => !v)}
        />
        <ScopePill
          active={showSpecific}
          label={`مشاريع محددة${specificProjectIds.size > 0 ? ` (${specificProjectIds.size})` : ''}`}
          color="amber"
          icon={<FolderTree className="w-3.5 h-3.5" />}
          onClick={toggleSpecific}
        />
      </div>

      {/* Project list — shown when "specific projects" is toggled on */}
      {showSpecific && (
        <div className="mb-3 rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20 p-3">
          {projects.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              لا توجد مشاريع مسجلة
            </p>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-2">
                اختر المشاريع التي يظهر فيها هذا التصنيف:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto pr-1">
                {projects.map(p => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 text-xs cursor-pointer rounded-lg p-1.5
                               hover:bg-amber-100/70 dark:hover:bg-amber-900/30 transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="rounded text-amber-500 border-amber-300 focus:ring-amber-400 w-3.5 h-3.5"
                      checked={specificProjectIds.has(p.id)}
                      onChange={e => toggleProject(p.id, e.target.checked)}
                    />
                    <span className="truncate text-foreground">{p.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className={`inline-flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg font-semibold transition-all duration-200
            disabled:opacity-60 ${
              savedOk
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
            }`}
        >
          {isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              جاري الحفظ...
            </>
          ) : savedOk ? (
            <>
              <Check className="w-3.5 h-3.5" />
              تم الحفظ
            </>
          ) : (
            'حفظ النطاق'
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Scope pill toggle button ──────────────────────────────────────────────── */
function ScopePill({
  active,
  label,
  color,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  color: 'blue' | 'emerald' | 'amber';
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const styles: Record<string, { on: string; off: string }> = {
    blue: {
      on:  'bg-blue-500 text-white border-blue-500 shadow-sm shadow-blue-200 dark:shadow-blue-900/30',
      off: 'border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20',
    },
    emerald: {
      on:  'bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-200 dark:shadow-emerald-900/30',
      off: 'border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/20',
    },
    amber: {
      on:  'bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-200 dark:shadow-amber-900/30',
      off: 'border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20',
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-semibold
                  transition-all duration-150 ${active ? styles[color].on : styles[color].off}`}
    >
      {icon}
      {label}
    </button>
  );
}
