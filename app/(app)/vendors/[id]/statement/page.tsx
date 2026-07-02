import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

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
    { data: claimZero }
  ] = await Promise.all([
    supabase.from('claims').select('id, project_id, claim_number, created_at, v_claim_totals(claim_cumulative_payable), projects(name)').eq('party_id', id).eq('claim_type', 'vendor').eq('status', 'approved'),
    supabase.from('vendor_prior_claims').select('*').eq('vendor_id', id),
    supabase.from('ledger_entries').select('id, entry_date, amount, memo, project_id, projects(name), created_at').eq('counterparty_id', id).eq('counterparty_type', 'vendor').eq('direction', 'out'),
    supabase.from('claims').select('id, opening_paid_amount, created_at, project_id, projects(name)').eq('party_id', id).eq('claim_type', 'vendor').eq('claim_number', 0).eq('status', 'approved')
  ]);

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

  // Claims
  for (const c of claims || []) {
    const due = Number((c as any).v_claim_totals?.[0]?.claim_cumulative_payable || 0);
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

  // Ledger Payments
  for (const lp of ledgerPayments || []) {
    rows.push({
      document_date: lp.entry_date || lp.created_at?.split('T')[0] || '',
      project_name: (lp.projects as any)?.name || '-',
      description: lp.memo || 'دفعة منصرفة',
      amount_due: 0,
      amount_paid: Number(lp.amount),
      sort_date: lp.created_at || lp.entry_date || '1970-01-01'
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
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">لا يوجد حركات مسجلة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
