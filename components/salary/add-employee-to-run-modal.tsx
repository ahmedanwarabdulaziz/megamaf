'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Search, UserPlus, Check, Users } from 'lucide-react';
import { addEmployeesToPayrollRun } from '@/lib/actions/salary';

type Employee = { id: string; full_name: string };

export function AddEmployeeToRunModal({ runId, employees }: { runId: string; employees: Employee[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const submittingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  // Auto-focus the search box when the modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e => e.full_name.toLowerCase().includes(q));
  }, [employees, search]);

  function toggleEmployee(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (filtered.every(e => selected.has(e.id))) {
      // deselect all visible
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(e => next.delete(e.id));
        return next;
      });
    } else {
      // select all visible
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(e => next.add(e.id));
        return next;
      });
    }
  }

  function handleClose() {
    setIsOpen(false);
    setSearch('');
    setSelected(new Set());
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (selected.size === 0) { alert('يجب اختيار موظف واحد على الأقل'); return; }
    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('run_id', runId);
      selected.forEach(id => formData.append('employee_ids[]', id));
      const result = await addEmployeesToPayrollRun(formData);
      if (result.error) {
        alert(result.error);
      } else {
        handleClose();
        router.refresh();
      }
    } catch (err: any) {
      alert(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id));

  const dialog = isOpen && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-5 border-b flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold">إضافة موظفين للدورة</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {employees.length > 0
                    ? `${employees.length} موظف متاح للإضافة`
                    : 'لا يوجد موظفون متاحون'}
                </p>
              </div>
            </div>

            {employees.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex-1">
                لا يوجد موظفون لديهم راتب محدد وغير مدرجين في هذه الدورة بالفعل.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                {/* Search */}
                <div className="p-4 border-b">
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                      ref={searchRef}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="بحث باسم الموظف..."
                      className="w-full pr-9 pl-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                {/* Select-all row */}
                {filtered.length > 1 && (
                  <div
                    className="flex items-center gap-3 px-4 py-2.5 border-b bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors select-none"
                    onClick={toggleAll}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${allFilteredSelected ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                      {allFilteredSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {allFilteredSelected ? 'إلغاء تحديد الكل' : `تحديد الكل (${filtered.length})`}
                    </span>
                  </div>
                )}

                {/* Employee list */}
                <div className="overflow-y-auto flex-1 divide-y divide-border/60">
                  {filtered.length === 0 ? (
                    <div className="p-6 text-center text-muted-foreground text-sm">
                      لا توجد نتائج مطابقة
                    </div>
                  ) : (
                    filtered.map(emp => {
                      const isChecked = selected.has(emp.id);
                      return (
                        <div
                          key={emp.id}
                          onClick={() => toggleEmployee(emp.id)}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors select-none ${isChecked ? 'bg-primary/5' : ''}`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                            {isChecked && <Check className="w-3 h-3 text-primary-foreground" />}
                          </div>
                          <span className="text-sm">{emp.full_name}</span>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t flex items-center justify-between gap-3 bg-muted/20">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {selected.size > 0 && (
                      <>
                        <Users className="w-4 h-4" />
                        <span>تم اختيار <strong className="text-foreground">{selected.size}</strong> موظف</span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
                    <Button type="submit" disabled={loading || selected.size === 0}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <UserPlus className="w-4 h-4 ml-1" />}
                      إضافة {selected.size > 0 ? `(${selected.size})` : ''}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <Button variant="outline" onClick={() => setIsOpen(true)}>
        <UserPlus className="w-4 h-4 ml-1" />
        إضافة موظف
      </Button>
      {dialog}
    </>
  );
}
