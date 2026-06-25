'use client';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatMoney } from '@/lib/money';

interface HistoryClaim {
  id: string;
  claim_number: number;
  claim_date: string;
  status: string;
  v_claim_totals?: {
    total_due_this_claim: number;
    claim_cumulative_payable: number;
    claim_cumulative_total: number;
  }[];
}

interface PriorClaim {
  id: string;
  cutoff_date: string;
  prior_certified_amount: number;
  prior_paid_amount: number;
  prior_retention_held: number;
}

export function ClaimHistory({
  claims,
  priorClaim = null,
}: {
  claims: HistoryClaim[];
  priorClaim?: PriorClaim | null;
}) {
  const [open, setOpen] = useState(false);

  const hasHistory = claims.length > 0 || !!priorClaim;
  if (!hasHistory) return null;

  const outstanding = priorClaim
    ? priorClaim.prior_certified_amount - priorClaim.prior_paid_amount - priorClaim.prior_retention_held
    : 0;

  return (
    <div className="border-t border-muted/40 mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 px-2 transition-colors"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {priorClaim ? `⚖️ رصيد افتتاحي + ` : ''}{claims.length} مستخلص سابق {open ? '(إخفاء)' : '(عرض السجل)'}
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-1">
          {/* Claim #0 — Prior history badge */}
          {priorClaim && (
            <div className="flex items-center justify-between text-xs py-2 px-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-700 dark:text-amber-300">مستخلص #0</span>
                <span className="text-muted-foreground">{priorClaim.cutoff_date}</span>
                <span className="px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                  تاريخي (قبل النظام)
                </span>
              </div>
              <div className="flex items-center gap-4 text-right">
                <span className="text-muted-foreground">مستخلص: <span className="font-medium">{formatMoney(priorClaim.prior_certified_amount)}</span></span>
                <span className="text-green-600">مدفوع: <span className="font-medium">{formatMoney(priorClaim.prior_paid_amount)}</span></span>
                {priorClaim.prior_retention_held > 0 && (
                  <span className="text-amber-600">محتجز: <span className="font-medium">{formatMoney(priorClaim.prior_retention_held)}</span></span>
                )}
                {outstanding > 0 && (
                  <span className="font-bold text-amber-700 dark:text-amber-300">متبقي: {formatMoney(outstanding)}</span>
                )}
              </div>
            </div>
          )}

          {/* In-system historical claims */}
          {claims.map(c => (
            <div key={c.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-muted/30">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="font-medium">مستخلص #{c.claim_number}</span>
                <span>{c.claim_date}</span>
                <span className={`px-1.5 py-0.5 rounded-full font-semibold ${
                  c.status === 'approved' ? 'bg-primary/10 text-primary' :
                  c.status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {c.status === 'approved' ? 'معتمد' : c.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                </span>
              </div>
              <div className="flex items-center gap-4 text-muted-foreground">
                <span>إجمالي: <span className="font-medium">{formatMoney(c.v_claim_totals?.[0]?.claim_cumulative_total || 0)}</span></span>
                <span>الصافي: <span className="font-semibold text-foreground">{formatMoney(c.v_claim_totals?.[0]?.claim_cumulative_payable || 0)}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
