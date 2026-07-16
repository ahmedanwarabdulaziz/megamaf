'use client';
// Force HMR recompile

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { createExpense, createDirectExpense, updateExpense, deleteExpense } from '@/lib/actions/expenses';
import { uploadFile } from '@/lib/upload';
import { AlertCircle, Pencil, Trash2 } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { formatMoney } from '@/lib/money';

interface Employee { id: string; full_name: string; }
interface BankAccount { bank_account_id: string; bank_name: string; account_name: string; current_balance: number; }

export function CreateExpenseModal({
  categories,
  projects,
  isSuperAdmin,
  employees = [],
  bankAccounts = [],
}: {
  categories: any[];
  projects: any[];
  isSuperAdmin: boolean;
  employees?: Employee[];
  bankAccounts?: BankAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('00000000-0000-0000-0000-000000000001');
  const [categoryId, setCategoryId] = useState('');
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [payDirectly, setPayDirectly] = useState(false);
  const [bankAccountId, setBankAccountId] = useState('');

  const close = () => {
    setOpen(false);
    setFiles([]);
    setError('');
    setSelectedProjectId('00000000-0000-0000-0000-000000000001');
    setCategoryId('');
    setTargetEmployeeId('');
    setPayDirectly(false);
    setBankAccountId('');
  };

  if (!open) return <Button onClick={() => setOpen(true)}>تسجيل مصروف</Button>;

  // ── Category filtering based on selected project ────────────────────────
  const MAIN_PROJECT = '00000000-0000-0000-0000-000000000001';
  const effectiveProjectId = selectedProjectId || MAIN_PROJECT;
  const isMainCompany = effectiveProjectId === MAIN_PROJECT;

  const filteredCategories = categories.filter((c: any) => {
    const scopes: any[] = c.scopes || [];
    if (scopes.length === 0) return true;
    return scopes.some(
      (s: any) =>
        s.scope === 'all_projects' ||
        (isMainCompany && s.scope === 'main_company') ||
        (s.scope === 'specific_project' && s.project_id === effectiveProjectId)
    );
  });

  const parents = filteredCategories.filter((c: any) => !c.parent_id);
  const parentIds = new Set(parents.map((c: any) => c.id));
  const childCategories = filteredCategories.filter((c: any) => c.parent_id && parentIds.has(c.parent_id));
  const orphanCategories = filteredCategories.filter((c: any) => c.parent_id && !parentIds.has(c.parent_id));
  
  const flatCategories = [
    ...parents.filter((p: any) => !childCategories.some((ch: any) => ch.parent_id === p.id)),
    ...orphanCategories
  ];

  const groupedParents = parents.filter((p: any) => childCategories.some((ch: any) => ch.parent_id === p.id));

  const hasNoCategories = filteredCategories.length === 0;

  const categoryOptions: any[] = [];
  
  flatCategories.forEach((c: any) => {
    categoryOptions.push({
      value: c.id,
      label: c.name
    });
  });

  groupedParents.forEach((parent: any) => {
    categoryOptions.push({
      value: parent.id,
      label: parent.name,
      isGroupHeader: true,
      className: 'bg-blue-50 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100 font-bold'
    });
    
    const children = childCategories.filter((ch: any) => ch.parent_id === parent.id);
    children.forEach((child: any) => {
      categoryOptions.push({
        value: child.id,
        label: `— ${child.name}`
      });
    });
  });

  const allProjectOptions = [
    { value: '00000000-0000-0000-0000-000000000001', label: '-- ميجاماف (الشركة الرئيسية) --' },
    ...projects.filter((p: any) => p.id !== '00000000-0000-0000-0000-000000000001').map((p: any) => ({ value: p.id, label: p.name }))
  ];

  const employeeOptions = [
    { value: '', label: '-- نفسي (أنا) --' },
    ...(employees || []).map((emp: any) => ({ value: emp.id, label: emp.full_name }))
  ];

  // ── Form submit ─────────────────────────────────────────────────────────
  async function action(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setLoading(true);
      setError('');

      if (payDirectly && !bankAccountId) {
        setError('يجب اختيار الحساب البنكي عند الدفع المباشر');
        return;
      }

      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await uploadFile(file, fileName);
        if (uploadError) throw new Error(uploadError);
        formData.append('attachment_url', fileName);
      }

      const result = payDirectly ? await createDirectExpense(formData) : await createExpense(formData);
      if (result && result.error) {
        setError(result.error);
        return;
      }
      close();
    } catch (e: any) {
      setError(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const today = new Date();
  const minDateStr = new Date(today.getTime() - (15 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card w-full max-w-md p-6 rounded-xl border shadow-lg relative max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">تسجيل مصروف جديد</h2>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <form action={action} className="space-y-4">

          {/* Employee selector — only visible to super admins */}
          {isSuperAdmin && employees.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">
                الموظف
                <span className="mr-1 text-[10px] font-normal text-muted-foreground">
                  (اتركه فارغاً لتسجيله باسمك)
                </span>
              </label>
              <div key="emp-select">
                <input type="hidden" name="target_employee_id" value={targetEmployeeId} />
                <SearchableSelect
                  options={employeeOptions}
                  value={targetEmployeeId}
                  onChange={setTargetEmployeeId}
                  placeholder="-- نفسي (أنا) --"
                />
              </div>
            </div>
          )}

          {/* Direct payment toggle — only visible to super admins with bank accounts */}
          {isSuperAdmin && bankAccounts.length > 0 && (
            <div className="space-y-2 p-3 rounded-md border bg-muted/30">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={payDirectly}
                  onChange={e => setPayDirectly(e.target.checked)}
                />
                دفع مباشر الآن (اعتماد وتسوية فوراً من حساب بنكي)
              </label>
              {payDirectly && (
                <div>
                  <label className="block text-sm font-medium mb-1">الحساب البنكي</label>
                  <select
                    name="bank_account_id"
                    required
                    value={bankAccountId}
                    onChange={e => setBankAccountId(e.target.value)}
                    className="w-full p-2 rounded-md border bg-background"
                  >
                    <option value="">-- اختر الحساب البنكي --</option>
                    {bankAccounts.map(b => (
                      <option key={b.bank_account_id} value={b.bank_account_id}>
                        {b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})
                      </option>
                    ))}
                  </select>
                  {bankAccountId && (
                    <p className="text-xs text-muted-foreground mt-1">
                      الرصيد الحالي: {formatMoney(bankAccounts.find(b => b.bank_account_id === bankAccountId)?.current_balance ?? 0)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Project — controls category filter */}
          <div>
            <label className="block text-sm font-medium mb-1">المشروع</label>
            <div key="proj-select">
              <input type="hidden" name="project_id" value={selectedProjectId} required />
              <SearchableSelect
                options={allProjectOptions}
                value={selectedProjectId}
                onChange={val => {
                  setSelectedProjectId(val);
                  setCategoryId('');
                }}
                placeholder="-- اختر المشروع --"
              />
            </div>
          </div>

          {/* Category — filtered by selected project */}
          <div>
            <label className="block text-sm font-medium mb-1">التصنيف</label>
            {hasNoCategories ? (
              <div className="w-full p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                لا توجد تصنيفات متاحة لهذا المشروع. يرجى مراجعة الإعدادات.
              </div>
            ) : (
              // key forces re-mount (reset selection) when project changes
              <div key={`cat-${effectiveProjectId}`}>
                <input type="hidden" name="category_id" value={categoryId} required />
                <SearchableSelect
                  options={categoryOptions}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="-- اختر التصنيف --"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">المبلغ</label>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="w-full p-2 rounded-md border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">التاريخ</label>
              <input
                name="expense_date"
                type="date"
                autoComplete="off"
                required
                defaultValue={today.toISOString().split('T')[0]}
                min={isSuperAdmin ? undefined : minDateStr}
                max={today.toISOString().split('T')[0]}
                className="w-full p-2 rounded-md border bg-background"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" rows={2} className="w-full p-2 rounded-md border bg-background" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">صورة / إيصال</label>
            <input
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="w-full p-2 rounded-md border bg-background text-sm"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={loading}
              className="w-full"
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={loading || hasNoCategories}
              className="w-full"
            >
              {loading ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EditExpenseModal({
  expense,
  categories,
  projects,
}: {
  expense: any;
  categories: any[];
  projects: any[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(expense.project_id || '');
  const [categoryId, setCategoryId] = useState(expense.category_id || '');
  const [amount, setAmount] = useState(expense.amount || '');
  const [expenseDate, setExpenseDate] = useState(expense.expense_date || '');
  const [notes, setNotes] = useState(expense.notes || '');

  const close = () => {
    setOpen(false);
    setFiles([]);
    setError('');
  };

  if (!open) return (
    <Button variant="ghost" size="icon" onClick={() => setOpen(true)} title="تعديل">
      <Pencil className="w-4 h-4 text-blue-500" />
    </Button>
  );

  const EDIT_MAIN_PROJECT = '00000000-0000-0000-0000-000000000001';
  const editEffectiveProjectId = selectedProjectId || EDIT_MAIN_PROJECT;
  const editIsMainCompany = editEffectiveProjectId === EDIT_MAIN_PROJECT;

  const editFilteredCategories = categories.filter((c: any) => {
    const scopes: any[] = c.scopes || [];
    if (scopes.length === 0) return true;
    return scopes.some(
      (s: any) =>
        s.scope === 'all_projects' ||
        (editIsMainCompany && s.scope === 'main_company') ||
        (s.scope === 'specific_project' && s.project_id === editEffectiveProjectId)
    );
  });

  const editParents = editFilteredCategories.filter((c: any) => !c.parent_id);
  const editParentIds = new Set(editParents.map((c: any) => c.id));
  const editChildCategories = editFilteredCategories.filter((c: any) => c.parent_id && editParentIds.has(c.parent_id));
  const editOrphanCategories = editFilteredCategories.filter((c: any) => c.parent_id && !editParentIds.has(c.parent_id));
  
  const editFlatCategories = [
    ...editParents.filter((p: any) => !editChildCategories.some((ch: any) => ch.parent_id === p.id)),
    ...editOrphanCategories
  ];

  const editGroupedParents = editParents.filter((p: any) => editChildCategories.some((ch: any) => ch.parent_id === p.id));
  const hasNoCategories = editFilteredCategories.length === 0;

  const editCategoryOptions: any[] = [];
  
  editFlatCategories.forEach((c: any) => {
    editCategoryOptions.push({
      value: c.id,
      label: c.name
    });
  });

  editGroupedParents.forEach((parent: any) => {
    editCategoryOptions.push({
      value: parent.id,
      label: parent.name,
      isGroupHeader: true,
      className: 'bg-blue-50 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100 font-bold'
    });
    
    const children = editChildCategories.filter((ch: any) => ch.parent_id === parent.id);
    children.forEach((child: any) => {
      editCategoryOptions.push({
        value: child.id,
        label: `— ${child.name}`
      });
    });
  });

  const editAllProjectOptions = [
    { value: '00000000-0000-0000-0000-000000000001', label: '-- ميجاماف (الشركة الرئيسية) --' },
    ...projects.filter((p: any) => p.id !== '00000000-0000-0000-0000-000000000001').map((p: any) => ({ value: p.id, label: p.name }))
  ];

  async function action(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setLoading(true);
      setError('');
      formData.append('id', expense.id);

      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await uploadFile(file, fileName);
        if (uploadError) throw new Error(uploadError);
        formData.append('attachment_url', fileName);
      }

      const result = await updateExpense(formData);
      if (result && result.error) {
        setError(result.error);
        return;
      }
      close();
    } catch (e: any) {
      setError(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card w-full max-w-md p-6 rounded-xl border shadow-lg relative max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">تعديل المصروف</h2>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <form action={action} className="space-y-4 text-right">

          <div>
            <label className="block text-sm font-medium mb-1">المشروع</label>
            <select
              name="project_id"
              className="w-full p-2 rounded-md border bg-background"
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
            >
              <option value="00000000-0000-0000-0000-000000000001">-- ميجاماف (الشركة الرئيسية) --</option>
              {projects.filter((p: any) => p.id !== '00000000-0000-0000-0000-000000000001').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">التصنيف</label>
            {hasNoCategories ? (
              <div className="w-full p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                لا توجد تصنيفات متاحة لهذا المشروع.
              </div>
            ) : (
              <div key={`cat-${editEffectiveProjectId}`}>
                <input type="hidden" name="category_id" value={categoryId} required />
                <SearchableSelect
                  options={editCategoryOptions}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="-- اختر التصنيف --"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">المبلغ</label>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full p-2 rounded-md border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">التاريخ</label>
              <input
                name="expense_date"
                type="date"
                autoComplete="off"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full p-2 rounded-md border bg-background"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea 
              name="notes" 
              rows={2} 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2 rounded-md border bg-background" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">إضافة مرفقات جديدة</label>
            <input
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="w-full p-2 rounded-md border bg-background text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              المرفقات السابقة ستبقى محفوظة. يمكنك إضافة مرفقات جديدة هنا.
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={loading}
              className="w-full"
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={loading || hasNoCategories}
              className="w-full"
            >
              {loading ? 'جاري الحفظ...' : 'تحديث'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    try {
      setLoading(true);
      setError('');
      const result = await deleteExpense(expenseId);
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
      }
    } catch (e: any) {
      setError(e.message || 'حدث خطأ');
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  if (error) return (
    <span className="text-xs text-destructive">{error}</span>
  );

  if (confirming) return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground whitespace-nowrap">تأكيد الحذف؟</span>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDelete}
        disabled={loading}
        className="h-7 w-7 text-destructive hover:bg-destructive/10"
        title="نعم، احذف"
      >
        {loading ? (
          <span className="w-3 h-3 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirming(false)}
        disabled={loading}
        className="h-7 w-7"
        title="إلغاء"
      >
        <span className="text-xs font-bold">✕</span>
      </Button>
    </div>
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setConfirming(true)}
      title="حذف"
    >
      <Trash2 className="w-4 h-4 text-destructive" />
    </Button>
  );
}
