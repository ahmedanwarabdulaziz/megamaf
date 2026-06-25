import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AssignPaymentButton } from './assign-payment-button';

export const metadata = { title: 'كشف حساب مالك' };

export default async function OwnerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // ── Batch 1: all independent queries in parallel ──────────────────────────
  const [
    { data: owner },
    { data: claims },
    { data: receipts },
    { data: projects },
  ] = await Promise.all([
    supabase.from('project_owners').select('*').eq('id', id).single(),
    supabase
      .from('claims')
      .select('id, claim_number, claim_date, project_id, projects(name)')
      .eq('party_id', id)
      .eq('claim_type', 'owner')
      .eq('status', 'approved')
      .order('claim_number', { ascending: true }),
    supabase
      .from('ledger_entries')
      .select('id, amount, project_id, entry_date, memo, projects(name), payment_allocations(allocated_amount)')
      .eq('counterparty_id', id)
      .eq('counterparty_type', 'owner')
      .eq('direction', 'in')
      .order('entry_date', { ascending: true }),
    supabase.from('projects').select('id, name').order('name'),
  ]);

  if (!owner) notFound();

  // ── Batch 2: claim totals (depends on claims from batch 1) ────────────────
  const allClaimIds = claims?.map((c) => c.id) ?? [];

  // Latest claim per project (for assign form)
  const seenProjects = new Set<string>();
  const latestClaims = (claims ?? [])
    .slice()
    .sort((a, b) => b.claim_number - a.claim_number)
    .filter((c) => {
      if (seenProjects.has(c.project_id)) return false;
      seenProjects.add(c.project_id);
      return true;
    });
  const latestClaimIds = latestClaims.map((c) => c.id);

  const [{ data: claimTotals }, { data: latestTotals }] = await Promise.all([
    allClaimIds.length > 0
      ? supabase.from('v_claim_totals').select('claim_id, claim_cumulative_payable').in('claim_id', allClaimIds)
      : Promise.resolve({ data: [] }),
    latestClaimIds.length > 0
      ? supabase.from('v_claim_totals').select('claim_id, total_due_this_claim').in('claim_id', latestClaimIds)
      : Promise.resolve({ data: [] }),
  ]);



  const openClaimsForAssign = latestClaims
    .map((c) => ({
      claim_id: c.id,
      claim_number: c.claim_number,
      project_id: c.project_id,
      amount_due: latestTotals?.find((t) => t.claim_id === c.id)?.total_due_this_claim ?? 0,
    }))
    .filter((c) => c.amount_due > 0);

  // ── 6. Build statement rows ────────────────────────────────────────────────
  // Claims: use INCREMENTAL billing amount (this claim's cumulative - previous claim's cumulative)
  // per project, so the statement correctly shows what was billed each period.
  type StatementRow = {
    date: string;
    project_name: string;
    description: string;
    amount_due: number;
    amount_paid: number;
    document_type: string;
    document_id: string;
    is_unassigned?: boolean; // receipt with no project or no allocations
    entry_amount?: number;   // original receipt amount (for assign form)
  };

  const rows: StatementRow[] = [];

  // Group claims by project for incremental billing computation
  const claimsByProject = new Map<string, typeof claims>();
  for (const c of claims ?? []) {
    const arr = claimsByProject.get(c.project_id) ?? [];
    arr.push(c);
    claimsByProject.set(c.project_id, arr);
  }

  for (const claim of claims ?? []) {
    const projectClaims = (claimsByProject.get(claim.project_id) ?? []).sort(
      (a, b) => a.claim_number - b.claim_number
    );
    const idx = projectClaims.findIndex((c) => c.id === claim.id);
    const prevClaim = idx > 0 ? projectClaims[idx - 1] : null;

    const cumulative =
      claimTotals?.find((t) => t.claim_id === claim.id)?.claim_cumulative_payable ?? 0;
    const prevCumulative = prevClaim
      ? (claimTotals?.find((t) => t.claim_id === prevClaim.id)?.claim_cumulative_payable ?? 0)
      : 0;
    const incremental = cumulative - prevCumulative;

    rows.push({
      date: claim.claim_date,
      project_name: (claim.projects as any)?.name ?? '—',
      description: `مستخلص رقم ${claim.claim_number}`,
      amount_due: incremental,
      amount_paid: 0,
      document_type: 'claim',
      document_id: claim.id,
    });
  }

  for (const receipt of receipts ?? []) {
    const totalAllocated = (receipt.payment_allocations as any[]).reduce(
      (sum: number, a: any) => sum + (a.allocated_amount ?? 0),
      0
    );
    const isUnassigned = !receipt.project_id || totalAllocated === 0;

    rows.push({
      date: receipt.entry_date,
      project_name: (receipt.projects as any)?.name ?? '—',
      description: receipt.memo || 'تحصيل دفعة',
      amount_due: 0,
      amount_paid: receipt.amount,
      document_type: 'receipt',
      document_id: receipt.id,
      is_unassigned: isUnassigned,
      entry_amount: receipt.amount,
    });
  }

  // Sort all rows by date
  rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Compute running balance
  let running = 0;
  const rowsWithBalance = rows.map((row) => {
    running += row.amount_due - row.amount_paid;
    return { ...row, running_balance: running };
  });

  // ── Summary totals ─────────────────────────────────────────────────────────
  const totalDue = rows.reduce((s, r) => s + r.amount_due, 0);
  const totalPaid = rows.reduce((s, r) => s + r.amount_paid, 0);
  const balance = totalDue - totalPaid;
  const unassignedCount = rows.filter((r) => r.is_unassigned).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/treasury?tab=receivables" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">كشف حساب مالك</h1>
          <p className="text-muted-foreground mt-1">المالك: {owner.name}</p>
        </div>
      </div>

      {/* Unassigned alert */}
      {unassignedCount > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <span className="text-lg mt-0.5">🟡</span>
          <div>
            <p className="font-semibold">
              {unassignedCount} دفعة تحتاج إلى توجيه
            </p>
            <p className="text-amber-700 text-xs mt-1">
              هذه الدفعات غير مرتبطة بمشروع أو مستخلص. استخدم زر <strong>توجيه ←</strong> لربطها.
            </p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-4 rounded-xl border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المطالبات</p>
          <p className="text-xl font-bold text-amber-600">{formatMoney(totalDue)}</p>
        </div>
        <div className="bg-card p-4 rounded-xl border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المتحصلات</p>
          <p className="text-xl font-bold text-green-600">{formatMoney(totalPaid)}</p>
        </div>
        <div className="bg-card p-4 rounded-xl border shadow-sm bg-muted/30">
          <p className="text-sm text-muted-foreground mb-1">الرصيد المتبقي</p>
          <p className="text-2xl font-bold text-primary">{formatMoney(balance)}</p>
        </div>
      </div>

      {/* Statement table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">التاريخ</th>
                <th className="p-3 font-medium">المشروع</th>
                <th className="p-3 font-medium">البيان</th>
                <th className="p-3 font-medium text-amber-600">مدين (مطلوب منه)</th>
                <th className="p-3 font-medium text-green-600">دائن (دفعة محصلة)</th>
                <th className="p-3 font-medium text-primary">الرصيد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rowsWithBalance.map((row, idx) => (
                <tr
                  key={`${row.document_type}_${row.document_id}_${idx}`}
                  className={`hover:bg-muted/30 transition-colors ${row.is_unassigned ? 'bg-amber-50/40' : ''}`}
                >
                  <td className="p-3 whitespace-nowrap">{row.date}</td>
                  <td className="p-3 text-muted-foreground">
                    {row.is_unassigned ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                        <span className="text-xs">🟡</span> غير محدد
                      </span>
                    ) : (
                      row.project_name
                    )}
                  </td>
                  <td className="p-3">
                    <div>
                      <span className="font-medium">{row.description}</span>
                      {/* Assign button for unassigned receipts */}
                      {row.is_unassigned && row.document_type === 'receipt' && (
                        <div className="mt-2">
                          <AssignPaymentButton
                            ledgerEntryId={row.document_id}
                            entryAmount={row.entry_amount!}
                            openClaims={openClaimsForAssign}
                            projects={projects ?? []}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-3 font-medium text-amber-600">
                    {row.amount_due > 0 ? formatMoney(row.amount_due) : '—'}
                  </td>
                  <td className="p-3 font-medium text-green-600">
                    {row.amount_paid > 0 ? formatMoney(row.amount_paid) : '—'}
                  </td>
                  <td className="p-3 font-bold text-primary" dir="ltr">
                    {formatMoney(row.running_balance)}
                  </td>
                </tr>
              ))}
              {rowsWithBalance.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    لا يوجد حركات مسجلة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Receive payment CTA */}
      <div className="flex justify-end">
        <Link
          href={`/treasury/receive/${id}`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          تسجيل تحصيل جديد +
        </Link>
      </div>
    </div>
  );
}
