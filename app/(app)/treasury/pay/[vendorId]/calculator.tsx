'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Loader2, Paperclip, FileText, Image, X, Receipt, ClipboardList } from 'lucide-react';
import { payVendor, payVendorFromExpense, assignVendorPayment } from '@/lib/actions/payments';
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
  claim_id: string;
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

type CreditEntry = {
  ledger_entry_id: string;
  vendor_id: string;
  entry_date: string;
  amount: number;
  remaining_credit: number;
  project_id: string | null;
  memo: string | null;
};

export function VendorPaymentCalculator({ vendorId, openDocs, banks, employees, projects, claimSummaries, creditEntries = [] }: { vendorId: string, openDocs: any[], banks: any[], employees: {id: string, full_name: string}[], projects: {id: string, name: string}[], claimSummaries?: ClaimSummary[], creditEntries?: CreditEntry[] }) {
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

  // ── Quick-view popups: vendor statement + latest claim details ─────────────
  // Both reuse the existing full pages inside a same-origin iframe instead of
  // re-implementing their queries here — always in sync with those pages, and
  // the Modal below just overlays them without navigating away from this
  // payment screen (closing it leaves you exactly where you were).
  // "Latest claim" is unambiguous once a project is selected (or there's only
  // one project to begin with); with several projects and none picked yet,
  // there's no single "latest claim" to show, so the button stays disabled.
  const targetClaimId = useMemo(() => {
    if (!claimSummaries || claimSummaries.length === 0) return null;
    if (projectId) return claimSummaries.find(s => s.project_id === projectId)?.claim_id || null;
    if (claimSummaries.length === 1) return claimSummaries[0].claim_id;
    return null;
  }, [claimSummaries, projectId]);

  // Funding source: pay from a bank account, from an employee's approved expense,
  // or settle from an existing unallocated payment already sitting with this vendor.
  const [fundingSource, setFundingSource] = useState<'bank' | 'expense' | 'credit'>('bank');
  const [creditEntryId, setCreditEntryId] = useState('');
  const totalCredit = useMemo(() => creditEntries.reduce((sum, c) => sum + Number(c.remaining_credit || 0), 0), [creditEntries]);

  const selectCreditEntry = (entry: CreditEntry) => {
    setCreditEntryId(entry.ledger_entry_id);
    setAmount(Number(entry.remaining_credit));
    if (!projectId && entry.project_id) setProjectId(entry.project_id);
  };

  // ── Quick "settle now" from the credit banner ──────────────────────────────
  // Only entries already tagged with a project can be auto-settled — that tag
  // is set once (on first assignment) and never changes, so it's an unambiguous
  // target. An entry with no project yet (recorded as a general/untagged
  // payment) genuinely needs a human to pick which project it belongs to —
  // that stays in the manual "تسوية من رصيد دائن سابق" flow below.
  type AutoSettleRow = {
    target_type: string;
    target_id: string;
    description: string;
    project_name: string;
    amount_due: number;
    amount_paid: number;
    remaining_due: number;
    allocate_now: number;
  };
  type AutoSettlePlan = { entry: CreditEntry; rows: AutoSettleRow[]; leftover: number };
  const [autoSettlePreview, setAutoSettlePreview] = useState<AutoSettlePlan[] | null>(null);
  const [autoSettling, setAutoSettling] = useState(false);

  const eligibleCreditEntries = useMemo(() => creditEntries.filter(e => !!e.project_id), [creditEntries]);
  const unassignableCreditTotal = useMemo(
    () => creditEntries.filter(e => !e.project_id).reduce((sum, e) => sum + Number(e.remaining_credit || 0), 0),
    [creditEntries]
  );

  const buildAutoSettlePreview = () => {
    const plans: AutoSettlePlan[] = eligibleCreditEntries.map(entry => {
      // Same rules as the manual credit-funding auto-allocate below: only
      // documents in the entry's own tagged project, excluding prior_claim
      // (not tracked in payment_allocations — see assign_vendor_payment).
      // Filled NEWEST-first (not the oldest-first order the regular payment
      // auto-fill uses): claims are cumulative — the latest approved claim for
      // a project already carries every prior claim's totals (see the summary
      // card above), so it's the one the vendor/admin actually track the
      // vendor's balance against day to day. Crediting it first keeps the
      // settlement aligned with the number people are actually looking at,
      // instead of quietly closing out an old claim (or claim #0's legacy
      // opening balance) nobody is watching.
      const projDocs = openDocs
        .filter(d => d.project_id === entry.project_id && d.document_type !== 'prior_claim')
        .slice()
        .sort((a, b) => new Date(b.document_date).getTime() - new Date(a.document_date).getTime());

      // Same cumulative-cap logic as the main auto-allocate effect — a claim's
      // own bucket can overstate what's truly still owed on the project once an
      // older claim absorbed extra payment, so total allocation across a
      // project's claim rows is capped at the SAME cumulative remaining shown
      // on the summary card.
      const capRemaining = new Map<string, number>();
      for (const s of claimSummaries || []) {
        capRemaining.set(s.project_id, Math.max(0, s.netCumulative + s.tax - s.totalPaid));
      }

      // Only list documents that actually receive money from this credit.
      // In the normal case that's just the latest claim — since claims are
      // cumulative, it already carries every prior claim's totals, so there's
      // no need to show claim #0 or other older claims the credit never
      // touches. They only reappear here automatically if this credit is
      // large enough that the latest claim's own bucket can't absorb all of
      // it and the fill genuinely spills into older claims — exactly the case
      // where seeing them matters.
      let remaining = Number(entry.remaining_credit);
      const rows: AutoSettleRow[] = [];
      for (const doc of projDocs) {
        if (remaining <= 0) break;
        const remainingDue = doc.amount_due - doc.amount_paid;
        if (remainingDue <= 0) continue;

        let allocAmount: number;
        if (doc.document_type === 'claim') {
          const capLeft = capRemaining.get(doc.project_id) ?? remainingDue;
          allocAmount = Math.min(remaining, remainingDue, capLeft);
          capRemaining.set(doc.project_id, capLeft - allocAmount);
        } else {
          allocAmount = Math.min(remaining, remainingDue);
        }
        if (allocAmount > 0) {
          // When this row IS the latest claim for its project (matched to a
          // claimSummaries entry — see how the main allocation table below
          // does the same match), display the CUMULATIVE due/paid/remaining
          // from the summary card instead of this claim's own narrow bucket:
          // the latest claim already carries every prior claim's totals, and
          // that cumulative figure is what's actually being tracked as "how
          // much this vendor is owed" — showing the bucket-only numbers here
          // would look inconsistent with the summary card just above. The
          // amount actually allocated/validated stays scoped to this claim's
          // own bucket regardless (allocAmount, capped by remainingDue) —
          // only the displayed context changes.
          const summary = doc.document_type === 'claim'
            ? claimSummaries?.find(s => s.project_id === doc.project_id && s.claim_id === doc.document_id)
            : undefined;

          rows.push({
            target_type: doc.document_type,
            target_id: doc.document_id,
            description: doc.description,
            project_name: projects.find(p => p.id === doc.project_id)?.name || doc.project_name || '',
            amount_due: summary ? (summary.netCumulative + summary.tax) : doc.amount_due,
            amount_paid: summary ? summary.totalPaid : doc.amount_paid,
            remaining_due: summary ? summary.remaining : remainingDue,
            allocate_now: allocAmount,
          });
          remaining -= allocAmount;
        }
      }
      return { entry, rows, leftover: remaining };
    }).filter(plan => plan.rows.length > 0);

    setAutoSettlePreview(plans);
  };

  const confirmAutoSettle = async () => {
    if (!autoSettlePreview || autoSettlePreview.length === 0) return;
    setAutoSettling(true);
    try {
      for (const plan of autoSettlePreview) {
        const apiAllocations = plan.rows
          .filter(r => r.allocate_now > 0)
          .map(r => ({ target_type: r.target_type, target_id: r.target_id, amount: r.allocate_now }));
        if (apiAllocations.length === 0) continue;
        const result = await assignVendorPayment(plan.entry.ledger_entry_id, plan.entry.project_id as string, apiAllocations);
        if (result && 'error' in result && result.error) {
          alert(result.error);
          setAutoSettling(false);
          return;
        }
      }
      router.push('/treasury');
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء التسوية التلقائية');
      setAutoSettling(false);
    }
  };

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
    // - claim rows carry that specific claim's own bucket in amount_due/amount_paid
    //   (relabeled claim#0-only rows are the one exception — see page.tsx)
    let remaining = amount;

    // Settling from an existing credit requires assign_vendor_payment's
    // per-document project match, so (a) a project must be explicitly picked
    // before any document is offered, and (b) prior_claim rows are excluded —
    // that target type isn't tracked in payment_allocations at all (routed
    // separately into vendor_prior_claims.prior_paid_amount), so consuming
    // credit against it would silently drift from what v_vendor_unallocated_credit
    // reports as remaining.
    const filteredDocs = fundingSource === 'credit'
      ? (projectId ? openDocs.filter(d => d.project_id === projectId && d.document_type !== 'prior_claim') : [])
      : (projectId ? openDocs.filter(d => d.project_id === projectId) : openDocs);

    // A claim's own bucket (remainingDue below) can sum to MORE than the project
    // truly owes, whenever an older claim in the same project absorbed extra
    // payment — that overpayment nets out in the cumulative remaining shown on
    // the summary card, but summing individual buckets loses it (a bucket can't
    // go negative). So auto-fill must cap total allocation across a project's
    // claim + prior_claim (claim #0) rows combined at that SAME cumulative
    // remaining, or a large payment amount could silently allocate more than the
    // vendor is actually still owed. Whatever isn't consumed stays in `remaining`
    // for later (non-claim) documents, same as any other row skipped for lack of room.
    const claimGroupCapRemaining = new Map<string, number>();
    for (const s of claimSummaries || []) {
      claimGroupCapRemaining.set(s.project_id, Math.max(0, s.netCumulative + s.tax - s.totalPaid));
    }

    const newAllocations = filteredDocs.map(doc => {
      // For cumulative claims: use the summary only for the description label and
      // the informational cumulative breakdown shown under it. The actual payable
      // amount (remainingDue/max) must stay doc.amount_due - doc.amount_paid — that's
      // THIS specific claim's own bucket (total_due_this_claim minus what's actually
      // allocated to it), the same scoping record_vendor_payment's RPC validates
      // against. Using the project-wide cumulative summary.remaining here instead
      // caused two bugs: a claim with real payable room in its own bucket could
      // vanish from this table (cumulative remaining went negative because an older
      // claim in the same project absorbed extra payment), or the input could accept
      // more than this claim's own bucket allows (cumulative remaining overstated
      // because an older claim's payment sits unallocated as vendor credit) — the
      // latter is what caused "Allocation of 30000 exceeds remaining due 27003.75".
      // Multiple claim rows can now appear for the same project (older unpaid
      // claims are no longer hidden), so the cumulative breakdown must only
      // attach to the ONE row it actually describes — matched by claim id, not
      // just project id, or every claim row for the project would show an
      // identical copy of the same project-wide breakdown.
      const summary = doc.document_type === 'claim'
        ? claimSummaries?.find(s => s.project_id === doc.project_id && s.claim_id === doc.document_id)
        : undefined;

      const remainingDue = doc.amount_due - doc.amount_paid;

      const description = doc.description;

      let allocAmount;
      if (doc.document_type === 'claim' || doc.document_type === 'prior_claim') {
        const capLeft = claimGroupCapRemaining.get(doc.project_id) ?? remainingDue;
        allocAmount = Math.min(remaining, remainingDue, capLeft);
        claimGroupCapRemaining.set(doc.project_id, capLeft - allocAmount);
      } else {
        allocAmount = Math.min(remaining, remainingDue);
      }
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
  }, [amount, openDocs, projectId, projects, claimSummaries, fundingSource]);

  const updateAllocation = (index: number, val: number) => {
    const newAllocations = [...allocations];
    newAllocations[index].amount = Math.min(val, newAllocations[index].max);
    setAllocations(newAllocations);
  };

  // Multiple claim rows for the same project (e.g. an older unpaid claim plus
  // the latest one) are merged into a single visual row so the user sees one
  // "مستخلص رقم N" line with the true combined remaining — matching the
  // project's cumulative summary — instead of several near-duplicate rows.
  // Each underlying claim keeps its own target_id/amount/max though, since
  // record_vendor_payment validates a payment against ONE specific claim's own
  // bucket. Typing a total into the merged row's input fans it out across the
  // underlying claims oldest-first, capped at each one's own max, so the
  // submitted allocations always stay within what the backend will accept.
  type DisplayRow =
    | { type: 'single'; index: number }
    | { type: 'group'; indices: number[] };

  const displayRows = useMemo(() => {
    const rows: DisplayRow[] = [];
    const groupRowByProject = new Map<string, DisplayRow & { type: 'group' }>();
    allocations.forEach((a, idx) => {
      // A claim #0 balance stays tagged 'prior_claim' (not relabeled to 'claim')
      // whenever a newer numbered claim exists for the project — see page.tsx's
      // relabeling comment — so it must merge into the same project group too,
      // or its share of the total silently shows up as a second row again.
      if (a.target_type === 'claim' || a.target_type === 'prior_claim') {
        const existing = groupRowByProject.get(a.project_id);
        if (existing) {
          existing.indices.push(idx);
        } else {
          const row: DisplayRow & { type: 'group' } = { type: 'group', indices: [idx] };
          groupRowByProject.set(a.project_id, row);
          rows.push(row);
        }
      } else {
        rows.push({ type: 'single', index: idx });
      }
    });
    return rows;
  }, [allocations]);

  const updateGroupAllocation = (indices: number[], val: number, cap: number) => {
    const newAllocations = [...allocations];
    let remaining = Math.min(Math.max(0, val), cap);
    for (const idx of indices) {
      const max = newAllocations[idx].max;
      const amt = Math.min(remaining, max);
      newAllocations[idx] = { ...newAllocations[idx], amount: amt };
      remaining -= amt;
    }
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
      // Upload attachments first — into the dedicated treasury bucket.
      // Settling from an existing credit doesn't create a new payment, so
      // there's nothing to attach a receipt to.
      const uploadedPaths: string[] = [];
      if (fundingSource !== 'credit') {
        for (const file of files) {
          const { key, error: uploadError } = await uploadTreasuryFile(file);
          if (uploadError || !key) throw new Error(uploadError || 'Upload failed');
          uploadedPaths.push(key);
        }
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
      if (fundingSource === 'credit') {
        if (!effectiveProjectId) {
          alert('يجب اختيار المشروع المرتبط بالمستندات المراد تسويتها من الرصيد.');
          setLoading(false);
          return;
        }
        if (allocatedRows.length === 0) {
          alert('اختر مستنداً واحداً على الأقل لتخصيص الرصيد له.');
          setLoading(false);
          return;
        }
        result = await assignVendorPayment(creditEntryId, effectiveProjectId, apiAllocations);
      } else if (fundingSource === 'expense') {
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

      if ('error' in result && result.error) {
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
    <>
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Quick-view: vendor statement + latest claim, without leaving this page ── */}
      <div className="flex items-center gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => router.push('?modal=vendor-statement')}>
          <Receipt className="w-4 h-4 ml-2" /> كشف حساب المقاول
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!targetClaimId}
          title={!targetClaimId ? 'اختر المشروع أعلاه أولاً لتحديد آخر مستخلص له' : undefined}
          onClick={() => router.push('?modal=last-claim')}
        >
          <ClipboardList className="w-4 h-4 ml-2" /> عرض آخر مستخلص
        </Button>
      </div>

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
      {/* ── Existing unallocated credit banner ── */}
      {creditEntries.length > 0 && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-lg p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-bold text-green-800 dark:text-green-400">لهذا المقاول رصيد دائن من دفعات سابقة لم تُخصص لأي مستند</p>
              <p className="text-sm text-green-700 dark:text-green-500 mt-1">يمكنك تسوية أي فاتورة أو مستخلص مفتوح من هذا الرصيد بدلاً من تسجيل دفعة نقدية جديدة — اختر &quot;تسوية من رصيد دائن سابق&quot; أدناه، أو استخدم التسوية التلقائية.</p>
              <p className="text-xs text-green-700/80 dark:text-green-500/80 mt-1.5">ملاحظة: هذا المبلغ مدفوع بالفعل ومحتسب ضمن &quot;المتبقي المستحق&quot; أعلاه — تخصيصه هنا لا يقلل المتبقي مرة أخرى، بل يوثّق فقط أي مستند تحديداً يخص هذا المبلغ.</p>
              {unassignableCreditTotal > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-500 mt-1.5">
                  {formatMoney(unassignableCreditTotal)} من هذا الرصيد غير مرتبط بمشروع بعد — لا يمكن تسويته تلقائياً، اختر مشروعه يدوياً أدناه أولاً.
                </p>
              )}
            </div>
            <div className="text-left shrink-0">
              <div className="text-xs text-green-700 dark:text-green-500">الرصيد المتاح</div>
              <div className="text-2xl font-bold text-green-800 dark:text-green-400">{formatMoney(totalCredit)}</div>
            </div>
          </div>
          {eligibleCreditEntries.length > 0 && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={buildAutoSettlePreview}>
                تسوية تلقائية الآن
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Auto-settle preview: shows exactly what will be applied before committing ── */}
      {autoSettlePreview && (
        <div className="bg-card border rounded-lg shadow-sm p-4 space-y-4">
          {autoSettlePreview.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد مستندات مفتوحة يمكن تسوية هذا الرصيد معها تلقائياً. استخدم &quot;تسوية من رصيد دائن سابق&quot; أدناه لاختيار مستند يدوياً.</p>
          ) : (
            <>
              <h3 className="font-bold text-sm">مراجعة التسوية التلقائية قبل التنفيذ</h3>
              <p className="text-xs text-muted-foreground">
                يبدأ التخصيص بآخر مستخلص معتمد (يحتوي على إجمالي المستخلصات السابقة تراكمياً) — مع المستحق والمدفوع والمتبقي لكل مستند سيُخصص له مبلغ، لتتأكد أن التخصيص صحيح قبل التنفيذ.
              </p>
              {autoSettlePreview.map(plan => (
                <div key={plan.entry.ledger_entry_id} className="border rounded overflow-hidden">
                  <div className="p-2 bg-muted/30 text-xs text-muted-foreground flex justify-between">
                    <span>دفعة {plan.entry.entry_date}{plan.entry.memo ? ` — ${plan.entry.memo}` : ''}</span>
                    <span>المتاح: {formatMoney(Number(plan.entry.remaining_credit))}</span>
                  </div>
                  <table className="w-full text-sm text-right">
                    <thead className="bg-muted/20 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 font-medium">المستند</th>
                        <th className="p-2 font-medium">المستحق</th>
                        <th className="p-2 font-medium">المدفوع</th>
                        <th className="p-2 font-medium">المتبقي</th>
                        <th className="p-2 font-medium">سيُخصص الآن</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {plan.rows.map(row => (
                        <tr key={row.target_id} className="bg-primary/5">
                          <td className="p-2">{row.description} <span className="text-muted-foreground">({row.project_name})</span></td>
                          <td className="p-2 text-muted-foreground">{formatMoney(row.amount_due)}</td>
                          <td className="p-2 text-muted-foreground">{formatMoney(row.amount_paid)}</td>
                          <td className="p-2 font-medium">{formatMoney(row.remaining_due)}</td>
                          <td className="p-2 font-bold text-primary">{formatMoney(row.allocate_now)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan.leftover > 0.01 && (
                    <div className="p-2 text-xs text-amber-700 dark:text-amber-500 border-t">
                      يبقى {formatMoney(plan.leftover)} من هذه الدفعة بدون تخصيص — لا توجد مستندات مفتوحة كافية لاستيعابه.
                    </div>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">هذا التخصيص يوثّق فقط المستندات المرتبطة بهذا الرصيد — لن يتغير &quot;المتبقي المستحق&quot; الإجمالي لأن هذا المبلغ محتسب فيه بالفعل.</p>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAutoSettlePreview(null)} disabled={autoSettling}>
              إلغاء
            </Button>
            {autoSettlePreview.length > 0 && (
              <Button type="button" size="sm" onClick={confirmAutoSettle} disabled={autoSettling}>
                {autoSettling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                تأكيد التسوية
              </Button>
            )}
          </div>
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
            {creditEntries.length > 0 && (
              <button
                type="button"
                onClick={() => { setFundingSource('credit'); setAmount(0); setBankId(''); setCreditEntryId(''); }}
                className={`flex-1 p-2 rounded border text-sm font-medium ${fundingSource === 'credit' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}
              >
                تسوية من رصيد دائن سابق
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fundingSource === 'bank' && (
            <div>
              <label className="block text-sm font-medium mb-1">الخزينة / الحساب البنكي المسدد منه</label>
              <select required value={bankId} onChange={e => setBankId(e.target.value)} className="w-full p-2 rounded border bg-background">
                <option value="">اختر الحساب...</option>
                {banks.map(bank => (
                  <optgroup key={bank.id} label={bank.name}>
                    {bank.accounts?.map((acc: any) => (
                      <option key={acc.bank_account_id} value={acc.bank_account_id}>
                        {acc.account_name} - {acc.account_number} ({formatMoney(acc.current_balance)})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          {fundingSource === 'expense' && (
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
            <label className="block text-sm font-medium mb-1">
              المشروع المرتبط {fundingSource === 'bank' ? '(مطلوب — حتى لو دفعة مقدمة بدون مستند بعد)' : fundingSource === 'credit' ? '(مطلوب لتخصيص الرصيد)' : ''}
            </label>
            <select required={fundingSource !== 'expense'} value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full p-2 rounded border bg-background">
              <option value="">{fundingSource === 'expense' ? 'عام (غير مرتبط بمشروع محدد)' : 'اختر المشروع...'}</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {fundingSource === 'bank' && (
              <p className="text-xs text-muted-foreground mt-1">
                هذا يضمن أن أي رصيد يتبقى من هذه الدفعة (دفعة مقدمة) يُخصص تلقائياً لأول مستخلص يُعتمد لهذا المشروع لاحقاً.
              </p>
            )}
          </div>
          {fundingSource !== 'credit' && (
            <div>
              <label className="block text-sm font-medium mb-1">البيان (ملاحظات)</label>
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className="w-full p-2 rounded border bg-background" placeholder="دفعة مقدمة، سداد مستخلص، إلخ..." />
            </div>
          )}

          {/* File upload */}
          {fundingSource !== 'credit' && (
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
          )}
        </div>

        {/* Credit picker */}
        {fundingSource === 'credit' && (
          <div>
            <label className="block text-sm font-medium mb-2">اختر الدفعة السابقة غير المخصصة</label>
            {!projectId && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-2">
                اختر المشروع المرتبط أولاً أعلاه، ثم اختر الدفعة السابقة التي تريد التسوية منها.
              </p>
            )}
            <div className="border rounded divide-y">
              {creditEntries.map(entry => (
                <label key={entry.ledger_entry_id} className={`flex items-center justify-between gap-3 p-3 cursor-pointer text-sm ${creditEntryId === entry.ledger_entry_id ? 'bg-primary/5' : ''}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <input type="radio" name="credit_entry" checked={creditEntryId === entry.ledger_entry_id} onChange={() => selectCreditEntry(entry)} />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{entry.entry_date}</div>
                      {entry.memo && <div className="text-xs text-muted-foreground truncate">{entry.memo}</div>}
                    </div>
                  </div>
                  <div className="text-left whitespace-nowrap">
                    <div className="text-xs text-muted-foreground">المتبقي غير المخصص</div>
                    <div className="font-bold text-primary">{formatMoney(Number(entry.remaining_credit))}</div>
                  </div>
                </label>
              ))}
            </div>
            {/* Read-only — driven by what's actually allocated to documents below,
                not something the user types in. Editing this had no real meaning
                since it never changed what got settled. */}
            {creditEntryId && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="p-3 rounded border bg-muted/30">
                  <div className="text-xs text-muted-foreground">المبلغ الذي سيتم تسويته الآن</div>
                  <div className="font-bold text-lg text-primary">{formatMoney(totalAllocated)}</div>
                </div>
                <div className="p-3 rounded border bg-muted/30">
                  <div className="text-xs text-muted-foreground">المتبقي من هذا الرصيد بعد التسوية</div>
                  <div className="font-bold text-lg text-green-600">{formatMoney(Number(creditEntries.find(c => c.ledger_entry_id === creditEntryId)?.remaining_credit || 0) - totalAllocated)}</div>
                </div>
              </div>
            )}
          </div>
        )}

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
            {/* Read-only — driven by what's actually allocated to documents below,
                not something the user types in (same pattern as the credit picker). */}
            {expenseId && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="p-3 rounded border bg-muted/30">
                  <div className="text-xs text-muted-foreground">المبلغ الذي سيتم دفعه الآن</div>
                  <div className="font-bold text-lg text-primary">{formatMoney(totalAllocated)}</div>
                </div>
                <div className="p-3 rounded border bg-muted/30">
                  <div className="text-xs text-muted-foreground">المتبقي من هذا المصروف بعد الدفع</div>
                  <div className="font-bold text-lg text-green-600">{formatMoney(Number(employeeExpenses.find(e => e.id === expenseId)?.available || 0) - totalAllocated)}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
          <h3 className="font-bold">{fundingSource === 'credit' ? 'تخصيص التسوية على المستندات' : 'توزيع الدفعة (التخصيص)'}</h3>
          <div className="text-sm">
            {fundingSource === 'credit' ? 'المتبقي من الرصيد غير المخصص' : 'المبلغ المتبقي كرصيد'}: <span className={`font-bold ${credit > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>{formatMoney(credit)}</span>
          </div>
        </div>
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="p-3 font-medium">المستند</th>
              <th className="p-3 font-medium">المشروع</th>
              <th className="p-3 font-medium">المتبقي للدفع</th>
              <th className="p-3 font-medium w-48">{fundingSource === 'credit' ? 'المبلغ المخصص' : 'سيُخصص تلقائياً'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayRows.map((row) => {
              const indices = row.type === 'group' ? row.indices : [row.index];
              const rows = indices.map(i => allocations[i]);
              // The row carrying the cumulative breakdown (grossTotal > 0) is the
              // one matched to claimSummaries in the effect above — use it for the
              // merged row's description/breakdown; fall back to the most recent
              // claim in the group (indices are oldest-first) if none matched.
              const summaryRow = rows.find(r => r.grossTotal > 0) || rows[rows.length - 1];
              // The group's true remaining is the SAME cumulative formula as the
              // summary card (netCumulative + tax - totalPaid) — not a sum of the
              // rows' own buckets, since a bucket can't go negative and would
              // therefore lose an older claim's overpayment netting against this one.
              const groupCap = summaryRow.grossTotal > 0
                ? Math.max(0, summaryRow.netCumulative + summaryRow.tax - summaryRow.totalPaid)
                : rows.reduce((sum, r) => sum + r.max, 0);
              const alloc = row.type === 'single'
                ? rows[0]
                : {
                    ...summaryRow,
                    max:    groupCap,
                    amount: rows.reduce((sum, r) => sum + r.amount, 0),
                  };
              const rowKey = row.type === 'group' ? `claim-group-${alloc.project_id}` : alloc.target_id;
              const handleChange = (val: number) => {
                if (row.type === 'group') updateGroupAllocation(indices, val, groupCap);
                else updateAllocation(row.index, val);
              };
              return (
              <tr key={rowKey} className={alloc.amount > 0 ? 'bg-primary/5' : ''}>

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
                        <span>الصافي التراكمي (قابل للدفع):</span>
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
                      <div className="flex justify-between gap-6 border-t border-primary/20 pt-1 mt-0.5 text-foreground font-semibold">
                        <span>المتبقي للدفع:</span>
                        <span className="text-primary">{formatMoney(alloc.netCumulative + alloc.tax - alloc.totalPaid)}</span>
                      </div>
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

                {/* Amount: editable only for credit settlement (a one-off, deliberate
                    choice of which document absorbs the credit). For a regular payment
                    it's read-only — the auto-fill above already decides this correctly
                    top-to-bottom, and any leftover doesn't need manual placement either:
                    it becomes credit that approve_claim() now auto-assigns to whichever
                    claim for this project is approved next. */}
                <td className="p-3 align-top pt-4">
                  {fundingSource === 'credit' ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={alloc.max}
                      value={alloc.amount || ''}
                      onChange={e => handleChange(parseFloat(e.target.value) || 0)}
                      className="w-full p-2 rounded border bg-background text-primary font-medium text-left"
                    />
                  ) : (
                    <span className="font-bold text-primary">{formatMoney(alloc.amount)}</span>
                  )}
                </td>
              </tr>
              );
            })}
            {allocations.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">لا يوجد مستندات مفتوحة لهذا المقاول. أي مبلغ سيتم تسجيله كرصيد دائن.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading || (fundingSource === 'credit' ? (!creditEntryId || totalAllocated <= 0) : amount <= 0 || (fundingSource === 'bank' ? !bankId : !expenseId))}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {fundingSource === 'credit' ? 'تسوية من الرصيد' : 'تسجيل الدفعة'}
        </Button>
      </div>
    </form>

    {/* ── Quick-view popups — reuse the real pages via iframe so they stay in
        sync with those pages with no duplicated queries; closing either one
        leaves you exactly on this payment screen. ── */}
    <Modal name="vendor-statement" title="كشف حساب المقاول" size="wide">
      <iframe
        src={`/vendors/${vendorId}/statement?embed=1`}
        title="كشف حساب المقاول"
        className="w-full h-[75vh] border-0 rounded-md bg-background"
      />
    </Modal>
    <Modal name="last-claim" title="تفاصيل آخر مستخلص" size="wide">
      {targetClaimId && (
        <iframe
          src={`/claims/${targetClaimId}?embed=1`}
          title="تفاصيل آخر مستخلص"
          className="w-full h-[75vh] border-0 rounded-md bg-background"
        />
      )}
    </Modal>
    </>
  );
}
