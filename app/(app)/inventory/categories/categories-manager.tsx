'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Pencil, Trash2, X, Check, FolderOpen, Tag } from 'lucide-react';
import { createItemCategory, renameItemCategory, deleteItemCategory } from '@/lib/actions/inventory';

interface Category { id: string; name: string; parent_id: string | null; }

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [pending, startTransition] = useTransition();
  const [newMainName, setNewMainName] = useState('');
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const mains = categories.filter(c => !c.parent_id);
  const subsOf = (parentId: string) => categories.filter(c => c.parent_id === parentId);

  function run(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) alert(result.error);
    });
  }

  function addCategory(name: string, parentId?: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const fd = new FormData();
    fd.set('name', trimmed);
    if (parentId) fd.set('parent_id', parentId);
    run(async () => {
      const result = await createItemCategory(fd);
      if (!result?.error) {
        if (parentId) setNewSubName(prev => ({ ...prev, [parentId]: '' }));
        else setNewMainName('');
      }
      return result;
    });
  }

  function saveRename(id: string) {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    const fd = new FormData();
    fd.set('id', id);
    fd.set('name', trimmed);
    run(async () => {
      const result = await renameItemCategory(fd);
      if (!result?.error) setEditingId(null);
      return result;
    });
  }

  function remove(id: string, name: string) {
    if (!confirm(`هل تريد حذف الفئة «${name}»؟`)) return;
    const fd = new FormData();
    fd.set('id', id);
    run(() => deleteItemCategory(fd));
  }

  function NameRow({ cat, isMain }: { cat: Category; isMain: boolean }) {
    const isEditing = editingId === cat.id;
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isMain
          ? <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
          : <Tag className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        {isEditing ? (
          <>
            <input
              autoFocus
              value={editingName}
              onChange={e => setEditingName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveRename(cat.id); } if (e.key === 'Escape') setEditingId(null); }}
              className="flex-1 min-w-0 p-1.5 rounded border bg-background text-sm"
            />
            <button type="button" onClick={() => saveRename(cat.id)} disabled={pending} className="text-green-600 hover:text-green-700 p-1">
              <Check className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground p-1">
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <span className={`flex-1 truncate ${isMain ? 'font-bold' : ''}`}>{cat.name}</span>
            <button
              type="button"
              title="إعادة تسمية"
              onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }}
              className="text-muted-foreground hover:text-primary p-1 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="حذف"
              onClick={() => remove(cat.id, cat.name)}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive p-1 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add main category */}
      <div className="bg-card p-4 rounded-lg border shadow-sm">
        <h2 className="font-bold border-b pb-2 mb-4">إضافة فئة رئيسية</h2>
        <div className="flex gap-2">
          <input
            value={newMainName}
            onChange={e => setNewMainName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(newMainName); } }}
            placeholder="مثال: مواد بناء، كهرباء، سباكة..."
            className="flex-1 p-2 rounded border bg-background text-sm"
          />
          <Button type="button" onClick={() => addCategory(newMainName)} disabled={pending || !newMainName.trim()}>
            {pending ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Plus className="w-4 h-4 ml-1" />}
            إضافة
          </Button>
        </div>
      </div>

      {/* Category tree */}
      <div className="space-y-4">
        {mains.length === 0 && (
          <div className="bg-card rounded-lg border shadow-sm p-8 text-center text-muted-foreground">
            لم يتم إضافة فئات بعد. ابدأ بإضافة فئة رئيسية بالأعلى.
          </div>
        )}
        {mains.map(main => (
          <div key={main.id} className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 p-3 bg-muted/40 border-b">
              <NameRow cat={main} isMain />
            </div>
            <div className="divide-y divide-border/60">
              {subsOf(main.id).map(sub => (
                <div key={sub.id} className="flex items-center gap-2 py-2 pr-8 pl-3 text-sm hover:bg-muted/20">
                  <NameRow cat={sub} isMain={false} />
                </div>
              ))}
              {/* Add sub-category */}
              <div className="flex items-center gap-2 py-2 pr-8 pl-3">
                <input
                  value={newSubName[main.id] || ''}
                  onChange={e => setNewSubName(prev => ({ ...prev, [main.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(newSubName[main.id] || '', main.id); } }}
                  placeholder="إضافة فئة فرعية..."
                  className="flex-1 p-1.5 rounded border bg-background text-sm max-w-xs"
                />
                <button
                  type="button"
                  onClick={() => addCategory(newSubName[main.id] || '', main.id)}
                  disabled={pending || !(newSubName[main.id] || '').trim()}
                  className="text-xs flex items-center gap-1 text-primary hover:bg-primary/10 border border-dashed border-primary/50 rounded px-2 py-1.5 transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" /> إضافة
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
