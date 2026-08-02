import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import { requirePageAccess } from '@/lib/require-page-access';
import { CollectedPaymentsTrigger } from '@/components/claims/collected-payments-modal';

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
    supabase.from(accountView).select('document_id, document_type, document_date, description, amount_paid').eq('party_id', claim.party_id).eq('project_id', claim.project_id),
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
  const paymentRecords = (accountRows || [])
    .filter((row: any) => Number(row.amount_paid || 0) > 0)
    .sort((a: any, b: any) => new Date(b.document_date).getTime() - new Date(a.document_date).getTime())
    .map((row: any) => ({
      id: `${row.document_type}_${row.document_id}`,
      document_type: row.document_type,
      document_date: row.document_date,
      description: row.description,
      amount_paid: Number(row.amount_paid || 0),
    }));
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

      {claim.status === 'pending' && claim.rejection_reason && (
        <div className="flex gap-2 items-start bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 rounded-lg p-3 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">سبب الرفض:</p>
            <p>{claim.rejection_reason}</p>
            <p className="text-xs mt-1 opacity-80">يرجى تعديل المستخلص وإعادة تقديمه للاعتماد.</p>
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-bold">بنود المستخلص</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">البند</th>
                <th className="p-3 font-medium">الوحدة</th>
                <th className="p-3 font-medium">السابق</th>
                <th className="p-3 font-medium">الحالي</th>
                <th className="p-3 font-medium">الإجمالي (كمية)</th>
                <th className="p-3 font-medium">سعر الوحدة</th>
                <th className="p-3 font-medium">نسبة الصرف</th>
                <th className="p-3 font-medium text-left">الإجمالي (ج.م)</th>
                <th className="p-3 font-medium">ملاحظة البند</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">لا توجد بنود</td>
                </tr>
              ) : (
                items.map((item) => {
                  const cumQty = Number(item.previous_qty || 0) + Number(item.current_qty || 0);
                  const disbursementPct = Number(item.disbursement_pct ?? 1.0);
                  const netTotal = Number(item.line_total || 0) * disbursementPct;
                  return (
                    <tr key={item.id} className="hover:bg-muted/30">
                      <td className="p-3 font-medium">{item.description}</td>
                      <td className="p-3 text-center text-muted-foreground">{item.unit || '-'}</td>
                      <td className="p-3 text-center text-muted-foreground whitespace-nowrap">{item.previous_qty}</td>
                      <td className="p-3 text-center whitespace-nowrap">{item.current_qty}</td>
                      <td className="p-3 text-center font-medium whitespace-nowrap">{cumQty}</td>
                      <td className="p-3 whitespace-nowrap">{formatMoney(item.unit_price)}</td>
                      <td className="p-3 whitespace-nowrap">{(disbursementPct * 100).toFixed(1)}%</td>
                      <td className="p-3 font-semibold text-left text-primary whitespace-nowrap">{formatMoney(netTotal)}</td>
                      <td className="p-3 text-muted-foreground">{item.notes || '-'}</td>
                    </tr>
                  );
                })
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
          <CollectedPaymentsTrigger
            partyName={partyName}
            total={alreadyPaid}
            records={paymentRecords}
            className="flex justify-between w-full text-green-700 dark:text-green-400 font-medium hover:underline decoration-dotted underline-offset-4 text-right"
          >
            <span>المحصّل فعلياً (جميع المستخلصات السابقة):</span>
            <span>- {formatMoney(alreadyPaid)}</span>
          </CollectedPaymentsTrigger>
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
