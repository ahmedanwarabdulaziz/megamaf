'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Paperclip, FileText, Image, X } from 'lucide-react';
import { payVendor, payVendorFromExpense } from '@/lib/actions/payments';
import { getEmployeeAvailableExpenses } from '@/lib/actions/expenses';
import { uploadTreasuryFile } from '@/lib/upload-treasury';
import { formatMoney } from '@/lib/money';
import { remainingLabel, remainingColorClass } from '@/lib/claim-financials';

type AvailableExpense = {
  id: string;
  expense_date: string;
  amount: number;
  notes: string | null;
  category_name: string;
  project_id: string;
  project_name: string;
  available: number;
};

type ClaimSummary = {
  project_id: string;
  project_name: string;
  claim_number: number;
  grossTotal: number;
  retained: number;
  netCumulative: number;
  tax: number;
  tax_rate: number;
  tax_enabled: boolean;
  totalPaid: number;
  openingPaid: number;
  remaining: number;
};

export function VendorPaymentCalculator({ vendorId, openDocs, bankAccounts, employees, projects, claimSummaries }: { vendorId: string, openDocs: any[], bankAccounts: any[], employees: {id: string, full_name: string}[], projects: {id: string, name: string}[], claimSummaries?: ClaimSummary[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState<number>(0);
  const [bankId, setBankId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [memo, setMemo] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const handleFiles = (flist: FileList | null) => {
    if (!flist) return;
    setFiles(prev => [...prev, ...Array.from(flist)]);
  };

  // Funding source: pay from a bank account, or from an employee's approved expense
  const [fundingSource, setFundingSource] = useState<'bank' | 'expense'>('bank');
  const [employeeId, setEmployeeId] = useState('');
  const [employeeExpenses, setEmployeeExpenses] = useState<AvailableExpense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [expenseId, setExpenseId] = useState('');
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expensePage, setExpensePage] = useState(0);
  const [showOtherProjectExpenses, setShowOtherProjectExpenses] = useState(false);
  const EXPENSES_PER_PAGE = 5;

  // The project to restrict the expense picker to by default: whichever project
  // the user explicitly picked, or — if they haven't — the vendor's only project
  // (when all of its open documents belong to a single project). Using an expense
  // entered under a different project to fund this payment silently double-counts
  // that spend across two projects' reports, so we restrict to same-project by
  // default and require an explicit opt-in to cross projects.
  const openDocProjectIds = useMemo(() => Array.from(new Set(openDocs.map(d => d.project_id).filter(Boolean))), [openDocs]);
  const targetProjectId = projectId || (openDocProjectIds.length === 1 ? openDocProjectIds[0] : '');

  useEffect(() => {
    if (fundingSource !== 'expense' || !employeeId) {
      setEmployeeExpenses([]);
      setExpenseId('');
      return;
    }
    setLoadingExpenses(true);
    setExpenseId('');
    setExpenseSearch('');
    setExpensePage(0);
    setShowOtherProjectExpenses(false);
    setAmount(0);
    getEmployeeAvailableExpenses(employeeId).then(result => {
      setEmployeeExpenses(result.data || []);
      setLoadingExpenses(false);
    });
  }, [fundingSource, employeeId]);

  const projectScopedExpenses = useMemo(() => {
    if (!targetProjectId || showOtherProjectExpenses) return employeeExpenses;
    return employeeExpenses.filter(exp => exp.project_id === targetProjectId);
  }, [employeeExpenses, targetProjectId, showOtherProjectExpenses]);

  const filteredExpenses = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    if (!q) return projectScopedExpenses;
    return projectScopedExpenses.filter(exp =>
      exp.category_name?.toLowerCase().includes(q) ||
      exp.notes?.toLowerCase().includes(q) ||
      exp.expense_date?.includes(q) ||
      exp.amount.toString().includes(q)
    );
  }, [projectScopedExpenses, expenseSearch]);

  useEffect(() => {
    setExpensePage(0);
  }, [expenseSearch, showOtherProjectExpenses]);

  const expensePageCount = Math.max(1, Math.ceil(filteredExpenses.length / EXPENSES_PER_PAGE));
  const pagedExpenses = filteredExpenses.slice(expensePage * EXPENSES_PER_PAGE, (expensePage + 1) * EXPENSES_PER_PAGE);

  const selectExpense = (exp: AvailableExpense) => {
    setExpenseId(exp.id);
    setAmount(exp.available);
  };

  // Array of { target_type, target_id, amount, max: number }
  const [allocations, setAllocations] = useState<any[]>([]);

  useEffect(() => {
    // Auto-allocate top-to-bottom
    // Note: openDocs already arrives clean from the server:
    // - prior_claim rows for projects with in-system claims are excluded
    // - claim rows have amount_due patched to summary.remaining
    let remaining = amount;

    const filteredDocs = projectId
      ? openDocs.filter(d => d.project_id === projectId)
      : openDocs;

    const newAllocations = filteredDocs.map(doc => {
      // For cumulative claims: use summary values so description and
      // المتبقي للدفع match what's shown in ملخص آخر مستخلص معتمد
      const summary = doc.document_type === 'claim'
        ? claimSummaries?.find(s => s.project_id === doc.project_id)
        : undefined;

      const remainingDue = summary
        ? summary.remaining
        : doc.amount_due - doc.amount_paid;

      const description = summary
        ? `مستخلص رقم ${summary.claim_number}`
        : doc.description;

      const allocAmount = Math.min(remaining, remainingDue);
      remaining -= allocAmount;
      return {
        target_type:   doc.document_type,
        target_id:     doc.document_id,
        amount:        allocAmount,
        max:           remainingDue,
        description,
        project_id:    doc.project_id || '',
        project_name:  projects.find(p => p.id === doc.project_id)?.name || doc.project_name || 'عام',
        // Breakdown fields from summary (for claim rows)
        grossTotal:    summary?.grossTotal    ?? 0,
        retained:      summary?.retained      ?? 0,
        netCumulative: summary?.netCumulative ?? 0,
        tax:           summary?.tax           ?? 0,
        tax_rate:      summary?.tax_rate      ?? 0,
        totalPaid:     summary?.totalPaid     ?? 0,
        openingPaid:   summary?.openingPaid   ?? 0,
      };
    });
    setAllocations(newAllocations);
  }, [amount, openDocs, projectId, projects, claimSummaries]);

  const updateAllocation = (index: number, val: number) => {
    const newAllocations = [...allocations];
    newAllocations[index].amount = Math.min(val, newAllocations[index].max);
    setAllocations(newAllocations);
  };

  const totalAllocated = useMemo(() => allocations.reduce((sum, a) => sum + (a.amount || 0), 0), [allocations]);
  const credit = amount - totalAllocated;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totalAllocated > amount) {
      alert('Total allocated exceeds payment amount.');
      return;
    }
    setLoading(true);

    try {
      // Upload attachments first — into the dedicated treasury bucket
      const uploadedPaths: string[] = [];
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await uploadTreasuryFile(file, fileName);
        if (uploadError) throw new Error(uploadError);
        uploadedPaths.push(fileName);
      }

      const allocatedRows = allocations.filter(a => a.amount > 0);
      const apiAllocations = allocatedRows.map(a => ({
        target_type: a.target_type,
        target_id: a.target_id,
        amount: a.amount
      }));

      // If the user didn't explicitly pick a project, but every allocated document
      // belongs to the same project, tag the payment with it automatically — otherwise
      // it's saved with no project_id, which makes claim-cumulative "remaining" totals
      // (computed per-project) never see this payment even though it's correctly
      // allocated against the claim.
      const allocatedProjectIds = Array.from(new Set(allocatedRows.map(a => a.project_id).filter(Boolean)));
      const effectiveProjectId = projectId || (allocatedProjectIds.length === 1 ? allocatedProjectIds[0] : '');

      let result;
      if (fundingSource === 'expense') {
        const formData = new FormData();
        formData.append('vendor_id', vendorId);
        formData.append('employee_id', employeeId);
        formData.append('expense_id', expenseId);
        formData.append('amount', amount.toString());
        formData.append('memo', memo);
        if (effectiveProjectId) formData.append('project_id', effectiveProjectId);
        result = await payVendorFromExpense(formData, apiAllocations, uploadedPaths);
      } else {
        const formData = new FormData();
        formData.append('vendor_id', vendorId);
        formData.append('bank_account_id', bankId);
        formData.append('amount', amount.toString());
        formData.append('memo', memo);
        if (effectiveProjectId) formData.append('project_id', effectiveProjectId);
        result = await payVendor(formData, apiAllocations, uploadedPaths);
      }

      if (result.error) {
        alert(result.error);
        setLoading(false);
      } else {
        router.push('/treasury');
      }
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء رفع المرفقات');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Claim Totals Summary Card (mirrors /claims page) ── */}
      {claimSummaries && claimSummaries.length > 0 && (
        <div className="bg-card rounded-lg border shadow-sm divide-y">
          <div className="px-4 py-3 bg-muted/30">
            <h3 className="font-bold text-sm">ملخص آخر مستخلص معتمد</h3>
          </div>
          {claimSummaries.map(s => (
            <div key={s.project_id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-start gap-4">
              {/* Project + claim info */}
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.project_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">مستخلص رقم {s.claim_number}</p>
              </div>

              {/* Financial breakdown (same as /claims page) */}
              <div className="flex flex-col items-end gap-1.5 min-w-[280px]">
                {/* Gross */}
                <div className="flex justify-between w-full gap-4 text-xs text-muted-foreground">
                  <span>إجمالي الأعمال التراكمي:</span>
                  <span className="font-medium">{formatMoney(s.grossTotal)}</span>
                </div>

                {/* Retention */}
                {s.retained > 0 && (
                  <div className="flex justify-between w-full gap-4 text-xs text-amber-600">
                    <span>المحتجز التراكمي (تأمين):</span>
                    <span className="font-medium">- {formatMoney(s.retained)}</span>
                  </div>
                )}

                {/* Net cumulative — THE KEY LINE */}
                <div className="flex justify-between w-full gap-4 text-xs text-muted-foreground border-t border-muted/30 pt-1">
                  <span>الصافي التراكمي (قابل للدفع):</span>
                  <span className="font-medium">{formatMoney(s.netCumulative)}</span>
                </div>

                {/* Tax */}
                {s.tax > 0 && (
                  <div className="flex justify-between w-full gap-4 text-xs text-muted-foreground">
                    <span>الضريبة ({(s.tax_rate * 100).toFixed(1)}%):</span>
                    <span>+ {formatMoney(s.tax)}</span>
                  </div>
                )}

                {/* Opening Paid (المدفوع قبل النظام) */}
                {s.openingPaid > 0 && (
                  <div className="flex justify-between w-full gap-4 text-xs text-amber-600 dark:text-amber-500">
                    <span>المدفوع قبل النظام:</span>
                    <span className="font-medium">- {formatMoney(s.openingPaid)}</span>
                  </div>
                )}

                {/* In-system paid */}
                {s.totalPaid - s.openingPaid > 0 && (
                  <div className="flex justify-between w-full gap-4 text-xs text-green-700 dark:text-green-400 font-medium">
                    <span>المدفوع (في النظام):</span>
                    <span>- {formatMoney(s.totalPaid - s.openingPaid)}</span>
                  </div>
                )}

                {/* Remaining / overpayment */}
                <div className="flex justify-between items-center w-full gap-4 border-t border-primary/20 pt-1.5 mt-0.5">
                  <span className="text-sm font-semibold">
                    {remainingLabel(s.remaining)}
                  </span>
                  <span className={`text-xl font-bold whitespace-nowrap ${remainingColorClass(s.remaining)}`}>
                    {s.remaining < 0 ? `(${formatMoney(Math.abs(s.remaining))})` : formatMoney(s.remaining)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="bg-card p-6 rounded-lg border shadow-sm space-y-4">
        {/* Funding source toggle */}
        <div>
          <label className="block text-sm font-medium mb-1">مصدر السداد</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setFundingSource('bank'); setAmount(0); }}
              className={`flex-1 p-2 rounded border text-sm font-medium ${fundingSource === 'bank' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}
            >
              من الخزينة / حساب بنكي
            </button>
            <button
              type="button"
              onClick={() => { setFundingSource('expense'); setAmount(0); setBankId(''); }}
              className={`flex-1 p-2 rounded border text-sm font-medium ${fundingSource === 'expense' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}
            >
              من عهدة موظف (مصروف معتمد)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fundingSource === 'bank' ? (
            <div>
              <label className="block text-sm font-medium mb-1">الخزينة / الحساب البنكي المسدد منه</label>
              <select required value={bankId} onChange={e => setBankId(e.target.value)} className="w-full p-2 rounded border bg-background">
                <option value="">اختر الحساب...</option>
                {bankAccounts.map(b => (
                  <option key={b.bank_account_id} value={b.bank_account_id}>{b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">الموظف</label>
              <select required value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full p-2 rounded border bg-background">
                <option value="">اختر الموظف...</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                ))}
              </select>
            </div>
          )}

          {fundingSource === 'bank' && (
            <div>
              <label className="block text-sm font-medium mb-1">المبلغ المسدد</label>
              <input required type="number" step="0.01" min="0" value={amount || ''} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="w-full p-2 rounded border bg-background font-bold text-lg text-primary" placeholder="0.00" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">المشروع المرتبط (للدفعات المقدمة)</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full p-2 rounded border bg-background">
              <option value="">عام (غير مرتبط بمشروع محدد)</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">البيان (ملاحظات)</label>
            <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className="w-full p-2 rounded border bg-background" placeholder="دفعة مقدمة، سداد مستخلص، إلخ..." />
          </div>

          {/* File upload */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">مرفقات الدفعة (إيصالات، صور التحويل، PDF)</label>
            <label
              htmlFor="payment-files"
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
            >
              <Paperclip className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">انقر لاختيار ملفات الإيصال</span>
              <input
                id="payment-files"
                type="file"
                multiple
                accept="image/*,.pdf"
                className="hidden"
                onChange={e => handleFiles(e.target.files)}
              />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm bg-muted/40 rounded px-2 py-1">
                    {f.type === 'application/pdf'
                      ? <FileText className="w-4 h-4 text-red-500 shrink-0" />
                      : <Image className="w-4 h-4 text-blue-500 shrink-0" />}
                    <span className="flex-1 truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}>
                      <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Expense picker */}
        {fundingSource === 'expense' && employeeId && (
          <div>
            <label className="block text-sm font-medium mb-2">اختر المصروف المعتمد الممول للدفعة</label>
            {loadingExpenses ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
                <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل...
              </div>
            ) : employeeExpenses.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3">لا يوجد مصروفات معتمدة لهذا الموظف بها رصيد غير مستخدم.</p>
            ) : (
              <>
                {targetProjectId && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground mb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showOtherProjectExpenses}
                      onChange={e => setShowOtherProjectExpenses(e.target.checked)}
                      className="w-3.5 h-3.5"
                    />
                    إظهار مصروفات من مشاريع أخرى (بشكل افتراضي تظهر فقط مصروفات نفس المشروع)
                  </label>
                )}
                <input
                  type="text"
                  value={expenseSearch}
                  onChange={e => setExpenseSearch(e.target.value)}
                  placeholder="بحث بالتصنيف، الملاحظات، التاريخ، أو المبلغ..."
                  className="w-full p-2 rounded border bg-background text-sm mb-2"
                />
                {projectScopedExpenses.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                    لا يوجد مصروفات معتمدة لهذا الموظف في هذا المشروع. فعّل "إظهار مصروفات من مشاريع أخرى" أعلاه لعرض كل المصروفات.
                  </p>
                ) : filteredExpenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">لا توجد نتائج مطابقة للبحث.</p>
                ) : (
                  <>
                    <div className="border rounded divide-y">
                      {pagedExpenses.map(exp => (
                        <label key={exp.id} className={`flex items-center justify-between gap-3 p-3 cursor-pointer text-sm ${expenseId === exp.id ? 'bg-primary/5' : ''}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <input type="radio" name="expense" checked={expenseId === exp.id} onChange={() => selectExpense(exp)} />
                            <div className="min-w-0">
                              <div className="font-medium truncate">{exp.category_name || 'مصروف'} — {exp.expense_date}</div>
                              {showOtherProjectExpenses && exp.project_name && (
                                <div className="text-xs text-primary/80 truncate">{exp.project_name}</div>
                              )}
                              {exp.notes && <div className="text-xs text-muted-foreground truncate">{exp.notes}</div>}
                            </div>
                          </div>
                          <div className="text-left whitespace-nowrap">
                            <div className="text-xs text-muted-foreground">المتاح</div>
                            <div className="font-bold text-primary">{formatMoney(exp.available)}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                    {expensePageCount > 1 && (
                      <div className="flex items-center justify-between mt-2 text-sm">
                        <button
                          type="button"
                          disabled={expensePage === 0}
                          onClick={() => setExpensePage(p => Math.max(0, p - 1))}
                          className="px-3 py-1 rounded border bg-background disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          السابق
                        </button>
                        <span className="text-muted-foreground">
                          صفحة {expensePage + 1} من {expensePageCount} ({filteredExpenses.length} مصروف)
                        </span>
                        <button
                          type="button"
                          disabled={expensePage >= expensePageCount - 1}
                          onClick={() => setExpensePage(p => Math.min(expensePageCount - 1, p + 1))}
                          className="px-3 py-1 rounded border bg-background disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          التالي
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {expenseId && (
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1">المبلغ المستخدم من المصروف</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  max={employeeExpenses.find(e => e.id === expenseId)?.available || 0}
                  value={amount || ''}
                  onChange={e => setAmount(Math.min(parseFloat(e.target.value) || 0, employeeExpenses.find(exp => exp.id === expenseId)?.available || 0))}
                  className="w-full p-2 rounded border bg-background font-bold text-lg text-primary"
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
          <h3 className="font-bold">توزيع الدفعة (التخصيص)</h3>
          <div className="text-sm">
            المبلغ المتبقي كرصيد: <span className={`font-bold ${credit > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>{formatMoney(credit)}</span>
          </div>
        </div>
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="p-3 font-medium">المستند</th>
              <th className="p-3 font-medium">المشروع</th>
              <th className="p-3 font-medium">المتبقي للدفع</th>
              <th className="p-3 font-medium w-48">المبلغ المخصص</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {allocations.map((alloc, idx) => (
              <tr key={alloc.target_id} className={alloc.amount > 0 ? 'bg-primary/5' : ''}>

                {/* Description + breakdown for claim rows */}
                <td className="p-3">
                  <div className="font-semibold mb-1">{alloc.description}</div>
                  {alloc.target_type === 'claim' && alloc.grossTotal > 0 && (
                    <div className="text-xs space-y-0.5 text-muted-foreground mt-1.5 border-t border-muted/30 pt-1.5">
                      <div className="flex justify-between gap-6">
                        <span>إجمالي الأعمال التراكمي:</span>
                        <span className="font-medium text-foreground">{formatMoney(alloc.grossTotal)}</span>
                      </div>
                      {alloc.retained > 0 && (
                        <div className="flex justify-between gap-6 text-amber-600">
                          <span>المحتجز التراكمي (تأمين):</span>
                          <span className="font-medium">- {formatMoney(alloc.retained)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-6 border-t border-primary/20 pt-1 mt-0.5 text-foreground font-semibold">
                        <span>المتبقي للدفع:</span>
                        <span className="text-primary">{formatMoney(alloc.netCumulative)}</span>
                      </div>
                      {alloc.tax > 0 && (
                        <div className="flex justify-between gap-6">
                          <span>الضريبة ({(alloc.tax_rate * 100).toFixed(1)}%):</span>
                          <span className="font-medium">+ {formatMoney(alloc.tax)}</span>
                        </div>
                      )}
                      {alloc.totalPaid > 0 && (
                        <div className="flex justify-between gap-6 text-green-600">
                          <span>المدفوع فعلياً:</span>
                          <span className="font-medium">- {formatMoney(alloc.totalPaid)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </td>

                <td className="p-3 text-muted-foreground align-top pt-4">{alloc.project_name}</td>

                {/* Remaining */}
                <td className="p-3 align-top pt-4">
                  <span className={`font-bold text-base ${alloc.max > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {formatMoney(alloc.max)}
                  </span>
                </td>

                {/* Input */}
                <td className="p-3 align-top pt-4">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={alloc.max}
                    value={alloc.amount || ''}
                    onChange={e => updateAllocation(idx, parseFloat(e.target.value) || 0)}
                    className="w-full p-2 rounded border bg-background text-primary font-medium text-left"
                  />
                </td>
              </tr>
            ))}
            {allocations.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">لا يوجد مستندات مفتوحة لهذا المقاول. أي مبلغ سيتم تسجيله كرصيد دائن.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading || amount <= 0 || (fundingSource === 'bank' ? !bankId : !expenseId)}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          تسجيل الدفعة
        </Button>
      </div>
    </form>
  );
}
