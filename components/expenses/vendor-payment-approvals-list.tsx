'use client';

import { useState } from 'react';
import { Banknote, Landmark, Users, HardHat, CheckCircle2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { ApproveRejectButtons } from '@/components/expenses/approve-reject-buttons';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';
import { approveVendorPaymentRequest, rejectVendorPaymentRequest } from '@/lib/actions/payments';
import { getTreasuryDownloadUrls } from '@/lib/actions/storage';

const TARGET_LABELS: Record<string, string> = {
  claim: 'مستخلص',
  invoice: 'فاتورة',
  prior_claim: 'مستخلص #0',
  retention_release: 'إفراج محتجز',
};

/**
 * Vendor payment requests waiting in /expenses/approvals. Deliberately styled
 * apart from the expense cards (emerald "payment voucher" look with a solid
 * header band) so an approver can tell at a glance that approving this one
 * pays a contractor rather than approving an employee expense.
 */
export function VendorPaymentApprovalsList({
  requests,
  tab,
  currentEmployeeId,
  isSuperAdmin,
}: {
  requests: any[];
  tab: string;
  currentEmployeeId: string;
  isSuperAdmin: boolean;
}) {
  const [items, setItems] = useState(requests);

  if (items.length === 0) return null;

  const total = items.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <section className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/[0.03] overflow-hidden">
      <div className="flex items-center justify-between gap-3 bg-emerald-600 text-white px-4 py-3">
        <div className="flex items-center gap-2 font-bold min-w-0">
          <HardHat className="w-5 h-5 shrink-0" />
          <span className="truncate">
            {tab === 'pending' ? 'سندات صرف مقاولين بانتظار الاعتماد' : 'سندات صرف مقاولين معتمدة'}
          </span>
          <span className="text-xs font-normal bg-white/20 rounded-full px-2 py-0.5 shrink-0">{items.length}</span>
        </div>
        <div className="font-bold whitespace-nowrap">{formatMoney(total)}</div>
      </div>

      <div className="p-3 sm:p-4 space-y-3">
        {items.map((r) => {
          const isBank = r.funding_type === 'bank';
          const allocations = ((r.allocations as any[]) || []).filter((a) => Number(a.amount) > 0);
          const allocated = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
          const leftover = Number(r.amount) - allocated;
          const isOwnRequest = r.requested_by === currentEmployeeId;
          const cannotSelfApprove = isOwnRequest && !isSuperAdmin;

          return (
            <div key={r.id} className="rounded-lg border border-emerald-500/30 bg-card shadow-sm overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                      <Banknote className="w-3 h-3" />
                      دفعة مقاول
                    </span>
                    <span className="font-bold text-lg truncate">{r.vendor?.name || 'مقاول'}</span>
                  </div>
                  {r.project?.name && <p className="text-xs text-muted-foreground truncate">{r.project.name}</p>}
                  {r.memo && <p className="text-sm text-muted-foreground">{r.memo}</p>}
                  <p className="text-xs text-muted-foreground">
                    قدّمها: <span className="font-medium text-foreground">{r.requester?.full_name || '—'}</span>
                    {' • '}
                    {new Date(r.created_at).toLocaleDateString('ar-EG')}
                  </p>
                </div>
                <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                  <AttachmentViewer attachments={r.attachments} fetchUrls={getTreasuryDownloadUrls} />
                  <div className="text-xl font-bold whitespace-nowrap text-emerald-700 dark:text-emerald-400">
                    {formatMoney(r.amount)}
                  </div>
                </div>
              </div>

              <div className="border-t border-dashed border-emerald-500/40 bg-emerald-500/[0.04] px-4 py-3 space-y-2">
                <div
                  className={
                    'flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-md w-fit ' +
                    (isBank
                      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                      : 'bg-purple-500/15 text-purple-700 dark:text-purple-400')
                  }
                >
                  {isBank ? <Landmark className="w-3.5 h-3.5 shrink-0" /> : <Users className="w-3.5 h-3.5 shrink-0" />}
                  <span>
                    {isBank
                      ? `مصدر السداد: ${r.funding_bank?.banks?.name || ''} - ${r.funding_bank?.account_name || ''}`
                      : `مصدر السداد: عهدة ${r.funding_employee?.full_name || ''}`}
                  </span>
                </div>

                {allocations.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {allocations.map((a, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                      >
                        {TARGET_LABELS[a.target_type] || a.target_type} • {formatMoney(Number(a.amount))}
                      </span>
                    ))}
                    {leftover > 0.005 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        رصيد دائن • {formatMoney(leftover)}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 dark:text-amber-400">دفعة مقدمة بدون مستند — تُسجَّل كرصيد دائن للمقاول.</p>
                )}

                {tab === 'pending' && (
                  <p className="text-xs text-muted-foreground">
                    عند الاعتماد يُسجَّل المبلغ فوراً في حساب المقاول ويُخصم من المصدر أعلاه.
                  </p>
                )}
              </div>

              {tab === 'pending' && (
                <div className="border-t p-3">
                  {cannotSelfApprove ? (
                    <p className="text-xs text-center text-muted-foreground">
                      لا يمكنك اعتماد طلب دفع قدّمته بنفسك — يعتمده مسؤول آخر.
                    </p>
                  ) : (
                    <ApproveRejectButtons
                      expenseId={r.id}
                      approveAction={approveVendorPaymentRequest}
                      rejectAction={rejectVendorPaymentRequest}
                      rejectTitle="سبب رفض دفعة المقاول"
                      rejectHint="سيتم إظهار هذا السبب لمقدّم الطلب، ولن يُسجَّل أي مبلغ في حساب المقاول."
                      onSuccess={() => setItems((prev) => prev.filter((x) => x.id !== r.id))}
                    />
                  )}
                </div>
              )}
              {tab === 'approved' && (
                <div className="border-t p-3 flex items-center justify-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  معتمدة{r.reviewer?.full_name ? ` بواسطة ${r.reviewer.full_name}` : ''} وسُجّلت في حساب المقاول
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
