import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';
import { getTreasuryDownloadUrls } from '@/lib/actions/storage';

export const metadata = { title: 'كشف حساب مقاول' };

export default async function VendorStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase.from('vendors').select('*').eq('id', id).single();
  if (!vendor) notFound();

  // Fetch all claims (for amount_due) and prior claims
  const [
    { data: claims },
    { data: priorClaims },
    { data: ledgerPayments },
    { data: claimZero },
    { data: invoices },
  ] = await Promise.all([
    // NOTE: v_claim_totals is a VIEW with no FK to `claims`, so it can't be embedded
    // via `.select('v_claim_totals(...)')` — PostgREST has no relationship to detect
    // and the whole query silently errors out (data comes back null). Fetch it as a
    // separate query below instead, same pattern as /treasury/pay/[vendorId]/page.tsx.
    supabase.from('claims').select('id, project_id, claim_number, created_at, projects(name)').eq('party_id', id).eq('claim_type', 'vendor').eq('status', 'approved'),
    supabase.from('vendor_prior_claims').select('*').eq('vendor_id', id),
    supabase.from('ledger_entries').select('id, entry_date, amount, memo, project_id, projects(name), created_at').eq('counterparty_id', id).eq('counterparty_type', 'vendor').eq('direction', 'out'),
    supabase.from('claims').select('id, opening_paid_amount, created_at, project_id, projects(name)').eq('party_id', id).eq('claim_type', 'vendor').eq('claim_number', 0).eq('status', 'approved'),
    // Suppliers (kind='vendor') are typically billed via invoices, not claims — a
    // vendor with zero claims but real invoices was previously invisible here,
    // showing 0 due against real ledger payments (see /reports/audit-log fix session).
    supabase.from('invoices').select('id, invoice_number, invoice_date, total, project_id, projects(name), created_at').eq('vendor_id', id).eq('status', 'approved'),
  ]);

  // claim_cumulative_payable is already cumulative for the whole project, so only the
  // LATEST claim per project should contribute a "due" row — summing every approved
  // claim's cumulative_payable would double-count work already folded into the latest one.
  const claimIds = (claims || []).map((c: any) => c.id);
  const { data: claimTotals } = claimIds.length > 0
    ? await supabase.from('v_claim_totals').select('claim_id, claim_cumulative_payable').in('claim_id', claimIds)
    : { data: [] as any[] };
  const payableByClaimId = new Map((claimTotals || []).map((t: any) => [t.claim_id, Number(t.claim_cumulative_payable || 0)]));

  const latestClaimPerProject = new Map<string, any>();
  for (const c of claims || []) {
    const existing = latestClaimPerProject.get(c.project_id);
    if (!existing || c.claim_number > existing.claim_number) {
      latestClaimPerProject.set(c.project_id, c);
    }
  }

  // Attachments (payment receipts) live in a separate bucket — fetch them keyed by ledger entry
  const ledgerPaymentIds = (ledgerPayments || []).map((lp: any) => lp.id);
  const { data: paymentAttachments } = ledgerPaymentIds.length > 0
    ? await supabase.from('attachments').select('entity_id, r2_key').eq('entity_type', 'vendor_payment').in('entity_id', ledgerPaymentIds)
    : { data: [] as any[] };
  const attachmentsByLedgerId = new Map<string, { r2_key: string }[]>();
  for (const a of paymentAttachments || []) {
    const list = attachmentsByLedgerId.get(a.entity_id) || [];
    list.push({ r2_key: a.r2_key });
    attachmentsByLedgerId.set(a.entity_id, list);
  }

  let rows: any[] = [];
  
  // Prior Claims
  for (const p of priorClaims || []) {
    const amountDue = Number(p.prior_certified_amount || 0) - Number(p.prior_retention_held || 0);
    if (amountDue > 0) {
      rows.push({
        document_date: p.created_at?.split('T')[0] || '',
        project_name: p.project_id ? 'مشروع سابق' : '-',
        description: 'رصيد مرحل مستحق',
        amount_due: amountDue,
        amount_paid: 0,
        sort_date: p.created_at || '1970-01-01'
      });
    }
    const amountPaid = Number(p.prior_paid_amount || 0);
    if (amountPaid > 0) {
      rows.push({
        document_date: p.created_at?.split('T')[0] || '',
        project_name: p.project_id ? 'مشروع سابق' : '-',
        description: 'رصيد مرحل منصرف',
        amount_due: 0,
        amount_paid: amountPaid,
        sort_date: p.created_at || '1970-01-01'
      });
    }
  }

  // Claim 0 opening paid
  for (const c of claimZero || []) {
    if (Number(c.opening_paid_amount) > 0) {
      rows.push({
        document_date: c.created_at?.split('T')[0] || '',
        project_name: (c.projects as any)?.name || '-',
        description: 'دفعة سابقة (مستخلص افتتاحي)',
        amount_due: 0,
        amount_paid: Number(c.opening_paid_amount),
        sort_date: c.created_at || '1970-01-01'
      });
    }
  }

  // Claims — only the latest claim per project (see note above)
  for (const c of latestClaimPerProject.values()) {
    const due = payableByClaimId.get(c.id) || 0;
    if (due > 0) {
      rows.push({
        document_date: c.created_at?.split('T')[0] || '',
        project_name: (c.projects as any)?.name || '-',
        description: `مستخلص رقم ${c.claim_number}`,
        amount_due: due,
        amount_paid: 0,
        sort_date: c.created_at || '1970-01-01'
      });
    }
  }

  // Invoices — the due side for suppliers billed via invoices rather than claims
  for (const inv of invoices || []) {
    const due = Number(inv.total || 0);
    if (due > 0) {
      rows.push({
        document_date: inv.invoice_date || inv.created_at?.split('T')[0] || '',
        project_name: (inv.projects as any)?.name || '-',
        description: inv.invoice_number ? `فاتورة رقم ${inv.invoice_number}` : 'فاتورة',
        amount_due: due,
        amount_paid: 0,
        sort_date: inv.created_at || inv.invoice_date || '1970-01-01'
      });
    }
  }

  // Ledger Payments
  for (const lp of ledgerPayments || []) {
    rows.push({
      document_date: lp.entry_date || lp.created_at?.split('T')[0] || '',
      project_name: (lp.projects as any)?.name || '-',
      description: lp.memo || 'دفعة منصرفة',
      amount_due: 0,
      amount_paid: Number(lp.amount),
      sort_date: lp.created_at || lp.entry_date || '1970-01-01',
      attachments: attachmentsByLedgerId.get(lp.id) || [],
    });
  }

  rows.sort((a, b) => a.sort_date.localeCompare(b.sort_date));

  let runningBalance = 0;
  let totalDue = 0;
  let totalPaid = 0;
  
  for (const row of rows) {
    totalDue += row.amount_due;
    totalPaid += row.amount_paid;
    runningBalance += row.amount_due - row.amount_paid;
    row.running_balance = runningBalance;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/treasury?tab=payables" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">كشف حساب مقاول</h1>
          <p className="text-muted-foreground mt-1">المقاول: {vendor.name}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المستحقات (له)</p>
          <p className="text-xl font-bold text-amber-600">{formatMoney(totalDue)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المدفوعات (ما تم صرفه)</p>
          <p className="text-xl font-bold text-green-600">{formatMoney(totalPaid)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border shadow-sm bg-muted/30">
          <p className="text-sm text-muted-foreground mb-1">الرصيد المتبقي</p>
          <p className="text-2xl font-bold text-primary">{formatMoney(runningBalance)}</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">التاريخ</th>
                <th className="p-3 font-medium">المشروع</th>
                <th className="p-3 font-medium">البيان</th>
                <th className="p-3 font-medium text-amber-600">دائن (مستحق له)</th>
                <th className="p-3 font-medium text-green-600">مدين (دفعة منصرفة)</th>
                <th className="p-3 font-medium text-primary">الرصيد التراكمي</th>
                <th className="p-3 font-medium">المرفقات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3">{row.document_date}</td>
                  <td className="p-3 text-muted-foreground">{row.project_name || '-'}</td>
                  <td className="p-3 font-medium">{row.description}</td>
                  <td className="p-3 font-medium text-amber-600">{row.amount_due > 0 ? formatMoney(row.amount_due) : '-'}</td>
                  <td className="p-3 font-medium text-green-600">{row.amount_paid > 0 ? formatMoney(row.amount_paid) : '-'}</td>
                  <td className="p-3 font-bold text-primary" dir="ltr">{formatMoney(row.running_balance)}</td>
                  <td className="p-3">
                    {row.attachments && row.attachments.length > 0
                      ? <AttachmentViewer attachments={row.attachments} fetchUrls={getTreasuryDownloadUrls} />
                      : <span className="text-muted-foreground">-</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">لا يوجد حركات مسجلة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
