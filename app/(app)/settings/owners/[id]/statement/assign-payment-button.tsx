'use client';

import { useState, useMemo, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignOwnerReceipt } from '@/lib/actions/payments';
import { formatMoney } from '@/lib/money';

interface OpenClaim {
  claim_id: string;
  claim_number: number;
  project_id: string;
  amount_due: number; // net remaining (from v_claim_totals)
}

interface Project {
  id: string;
  name: string;
}

interface AssignPaymentButtonProps {
  ledgerEntryId: string;
  entryAmount: number;
  /** Latest approved claim per project for this owner — filtered client-side on project selection */
  openClaims: OpenClaim[];
  projects: Project[];
}

export function AssignPaymentButton({
  ledgerEntryId,
  entryAmount,
  openClaims,
  projects,
}: AssignPaymentButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [allocAmount, setAllocAmount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Latest open claim for the selected project (null if none)
  const activeClaim = useMemo(
    () => openClaims.find((c) => c.project_id === projectId) ?? null,
    [openClaims, projectId]
  );

  // Auto-fill allocation amount when project / claim changes
  useEffect(() => {
    if (activeClaim) {
      setAllocAmount(Math.min(entryAmount, activeClaim.amount_due));
    } else {
      setAllocAmount(0);
    }
  }, [activeClaim, entryAmount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const allocations =
      activeClaim && allocAmount > 0
        ? [{ target_type: 'claim', target_id: activeClaim.claim_id, amount: allocAmount }]
        : [];

    startTransition(async () => {
      const result = await assignOwnerReceipt(ledgerEntryId, projectId, allocations);
      if ('error' in result && result.error) {
        setError(result.error);
      } else {
        setIsOpen(false);
        router.refresh();
      }
    });
  }

  /* ── Closed: just the trigger button ─────────────────────────────────── */
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-full hover:bg-amber-100 transition-colors whitespace-nowrap"
        title="توجيه هذه الدفعة لمشروع ومستخلص"
      >
        <span>🟡</span> توجيه ←
      </button>
    );
  }

  /* ── Open: inline form ────────────────────────────────────────────────── */
  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 p-4 bg-amber-50/60 border border-amber-200 rounded-xl space-y-3 text-sm"
    >
      <p className="font-semibold text-amber-800">توجيه الدفعة ({formatMoney(entryAmount)})</p>

      {/* Project picker */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">المشروع *</label>
        <select
          required
          value={projectId}
          onChange={(e) => { setProjectId(e.target.value); setError(null); }}
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none"
        >
          <option value="">— اختر المشروع —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Claim allocation — only if a project is selected */}
      {projectId && (
        <div className="space-y-2">
          {activeClaim ? (
            <>
              <label className="block text-xs font-medium text-muted-foreground">
                تخصيص لمستخلص
              </label>
              <div className="flex items-center gap-3 bg-background border rounded-lg px-3 py-2">
                <span className="flex-1 text-sm">
                  مستخلص #{activeClaim.claim_number}
                  <span className="text-muted-foreground mr-1">
                    (متبقي: {formatMoney(activeClaim.amount_due)})
                  </span>
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Math.min(entryAmount, activeClaim.amount_due)}
                  value={allocAmount || ''}
                  onChange={(e) => setAllocAmount(parseFloat(e.target.value) || 0)}
                  className="w-28 px-2 py-1 border rounded text-right text-sm bg-background focus:ring-2 focus:ring-amber-400 focus:outline-none"
                  placeholder="0.00"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                دفعة مقدمة: <span className="font-medium">{formatMoney(entryAmount - allocAmount)}</span>
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              لا توجد مستخلصات مفتوحة لهذا المالك في هذا المشروع.
              سيتم تسجيل المبلغ كاملاً كدفعة مقدمة مرتبطة بالمشروع.
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠️ {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={() => { setIsOpen(false); setError(null); }}
          className="px-3 py-1.5 text-xs rounded-lg border text-muted-foreground hover:bg-muted transition-colors"
        >
          إلغاء
        </button>
        <button
          type="submit"
          disabled={!projectId || isPending}
          className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
        >
          {isPending ? '…جارٍ الحفظ' : 'حفظ التوجيه ✓'}
        </button>
      </div>
    </form>
  );
}
