import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import { requirePageAccess } from '@/lib/require-page-access';

export const metadata = { title: 'عرض المستخلص' };

export default async function ViewClaimPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess('claims');
  const { id } = await params;
  const supabase = await createClient();

  const { data: claim } = await supabase
    .from('claims')
    .select('*, claim_items(*)')
    .eq('id', id)
    .order('created_at', { referencedTable: 'claim_items', ascending: true })
    .single();

  if (!claim) notFound();

  const accountView = claim.claim_type === 'owner' ? 'v_owner_account' : 'v_vendor_account';

  const [{ data: totalsRow }, partyResult, { data: project }, { data: accountRows }, { data: approvedClaims }] = await Promise.all([
    supabase.from('v_claim_totals').select('*').eq('claim_id', id).maybeSingle(),
    claim.claim_type === 'vendor'
      ? supabase.from('vendors').select('name').eq('id', claim.party_id).single()
      : supabase.from('project_owners').select('name').eq('id', claim.party_id).single(),
    supabase.from('projects').select('name').eq('id', claim.project_id).single(),
    // Same "already paid" source the create form uses, so this summary matches /claims/create exactly.
    supabase.from(accountView).select('amount_paid').eq('party_id', claim.party_id).eq('project_id', claim.project_id),
    supabase.from('claims').select('opening_paid_amount')
      .eq('party_id', claim.party_id).eq('project_id', claim.project_id)
      .eq('claim_type', claim.claim_type).eq('status', 'approved'),
  ]);
  const partyName = (partyResult.data as any)?.name || '';

  const items = (claim.claim_items || []) as any[];

  const grossTotal    = Number(totalsRow?.claim_cumulative_total || 0);
  const retained      = Number(totalsRow?.claim_cumulative_retained || 0);
  const netCumulative = Number(totalsRow?.claim_cumulative_payable || 0);
  const taxAmount     = claim.tax_enabled ? netCumulative * Number(claim.tax_rate || 0) : 0;
  const totalDue      = netCumulative + taxAmount;
  const alreadyPaid   = (accountRows || []).reduce((sum, row: any) => sum + Number(row.amount_paid || 0), 0);
  const openingPaidReference = (approvedClaims || []).reduce((sum, c: any) => sum + Number(c.opening_paid_amount || 0), 0);
  const remaining     = Math.max(0, totalDue - alreadyPaid);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">
              {claim.claim_number === 0 ? 'مستخلص #0 — رصيد افتتاحي' : `مستخلص رقم ${claim.claim_number}`}
            </h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              claim.status === 'approved'
                ? 'bg-primary text-primary-foreground'
                : claim.status === 'rejected'
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}>
              {claim.status === 'approved' ? 'معتمد' : claim.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{partyName} — {project?.name}</p>
          <p className="text-xs text-muted-foreground mt-1">التاريخ: {claim.claim_date}</p>
        </div>
        <Link href="/claims" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0">
          <ArrowRight className="w-4 h-4" /> عودة للمستخلصات
        </Link>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-bold">بنود المستخلص</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">البيان</th>
                <th className="p-3 font-medium">الكمية السابقة</th>
                <th className="p-3 font-medium">الكمية الحالية (تراكمي)</th>
                <th className="p-3 font-medium">سعر الوحدة</th>
                <th className="p-3 font-medium">الإجمالي</th>
                <th className="p-3 font-medium">ملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد بنود</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30">
                    <td className="p-3 font-medium">{item.description}</td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">{item.previous_qty} {item.unit || ''}</td>
                    <td className="p-3 whitespace-nowrap">{item.current_qty} {item.unit || ''}</td>
                    <td className="p-3 whitespace-nowrap">{formatMoney(item.unit_price)}</td>
                    <td className="p-3 font-semibold whitespace-nowrap">{formatMoney(item.line_total)}</td>
                    <td className="p-3 text-muted-foreground">{item.notes || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-muted/30 rounded-lg border p-4 space-y-2.5 text-sm max-w-md mr-auto">

        {/* ── Claim #0 Paid Amount (reference) ── */}
        {openingPaidReference > 0 && (
          <div className="flex justify-between text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
            <span>المدفوع قبل النظام (مرجع):</span>
            <span className="font-semibold">- {formatMoney(openingPaidReference)}</span>
          </div>
        )}

        {/* Gross */}
        <div className="flex justify-between text-muted-foreground">
          <span>إجمالي الأعمال التراكمي:</span>
          <span className="font-medium">{formatMoney(grossTotal)}</span>
        </div>

        {/* Retention */}
        {retained > 0 && (
          <div className="flex justify-between text-amber-600">
            <span>المحتجز التراكمي (تأمين):</span>
            <span className="font-medium">- {formatMoney(retained)}</span>
          </div>
        )}

        {/* Net cumulative */}
        <div className="flex justify-between text-muted-foreground border-t border-muted/30 pt-1">
          <span>الصافي التراكمي (قابل للدفع):</span>
          <span className="font-medium">{formatMoney(netCumulative)}</span>
        </div>

        {/* Tax */}
        {claim.tax_enabled && (
          <div className="flex justify-between text-muted-foreground">
            <span>الضريبة ({(Number(claim.tax_rate || 0) * 100).toFixed(1)}%):</span>
            <span>+ {formatMoney(taxAmount)}</span>
          </div>
        )}

        {/* Collected (prior paid) */}
        {alreadyPaid > 0 && (
          <div className="flex justify-between text-green-700 dark:text-green-400 font-medium">
            <span>المحصّل فعلياً (جميع المستخلصات السابقة):</span>
            <span>- {formatMoney(alreadyPaid)}</span>
          </div>
        )}

        {/* Remaining headline */}
        <div className="border-t border-primary/20 pt-3 flex justify-between items-center font-bold text-xl">
          <span className="text-sm font-semibold">
            {remaining <= 0 ? '✓ تم السداد بالكامل' : 'المتبقي المستحق:'}
          </span>
          <span className={remaining <= 0 ? 'text-green-600' : ''}>
            {formatMoney(remaining)}
          </span>
        </div>

        {claim.notes && (
          <div className="pt-2 border-t text-sm">
            <p className="text-muted-foreground text-xs mb-1">ملاحظات المستخلص:</p>
            <p>{claim.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
