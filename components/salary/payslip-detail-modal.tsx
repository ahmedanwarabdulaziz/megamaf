'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { X, ExternalLink } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { payslipStatusLabel } from '@/lib/salary-financials';
import { PayslipComponentForm } from '@/components/salary/payslip-component-form';
import { PayslipAllocationForm } from '@/components/salary/payslip-allocation-form';

type Component = { id: string; component_type: string; label: string; amount: number; notes?: string | null };
type AllocationRow = { project_id: string; allocation_type: 'percentage' | 'fixed_amount'; allocation_value: number; project_name?: string; allocated_amount?: number };
type Project = { id: string; name: string };

type Payslip = {
  id: string;
  runId: string;
  employeeName: string;
  status: string;
  base_amount: number;
  allowances_total: number;
  bonus_total: number;
  deductions_total: number;
  loan_deduction_total: number;
  gross_amount: number;
  net_amount: number;
  estimatedLoanDeduction: number;
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-secondary text-secondary-foreground',
  approved: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

export function PayslipDetailModal({
  payslip,
  components,
  allocations,
  projects,
}: {
  payslip: Payslip;
  components: Component[];
  allocations: AllocationRow[];
  projects: Project[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const isDraft = payslip.status === 'draft';

  const dialog = isOpen && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 overflow-hidden" onClick={() => setIsOpen(false)}>
          <div
            className="bg-card rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto overflow-x-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">{payslip.employeeName}</h2>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[payslip.status]}`}>
                  {payslipStatusLabel(payslip.status)}
                </span>
              </div>
              <button onClick={() => setIsOpen(false)} className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Hero net-pay banner — while draft, net_amount doesn't yet reflect
                  loan deductions (only computed at approval), so subtract the
                  estimate here to agree with the breakdown card below. */}
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-5 py-4 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-muted-foreground">الصافي المستحق للموظف</span>
                  {isDraft && payslip.estimatedLoanDeduction > 0 && (
                    <p className="text-[11px] text-amber-600 mt-0.5">شامل خصم سلفة متوقع عند الاعتماد</p>
                  )}
                </div>
                <span className="text-2xl font-black text-primary">
                  {formatMoney(isDraft ? payslip.net_amount - payslip.estimatedLoanDeduction : payslip.net_amount)}
                </span>
              </div>

              {/* 3 clearly separated cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
                {/* Breakdown card */}
                <div className="min-w-0 p-4 rounded-xl bg-background border border-border/50 shadow-sm space-y-2">
                  <h3 className="font-semibold text-xs text-muted-foreground flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    تفاصيل الراتب
                  </h3>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">الأساسي</span><span className="font-medium">{formatMoney(payslip.base_amount)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">البدلات</span><span className="font-medium text-green-600">{formatMoney(payslip.allowances_total)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">المكافآت</span><span className="font-medium text-green-600">{formatMoney(payslip.bonus_total)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">الخصومات</span><span className="font-medium text-destructive">{formatMoney(payslip.deductions_total)}</span></div>
                  {isDraft ? (
                    payslip.estimatedLoanDeduction > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">خصم السلف (متوقع)</span>
                        <span className="font-medium text-amber-600">{formatMoney(payslip.estimatedLoanDeduction)}</span>
                      </div>
                    )
                  ) : (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">خصم السلف</span><span className="font-medium text-destructive">{formatMoney(payslip.loan_deduction_total)}</span></div>
                  )}
                  <div className="flex justify-between text-sm border-t border-border/50 pt-2"><span className="text-muted-foreground">الإجمالي</span><span className="font-medium">{formatMoney(payslip.gross_amount)}</span></div>
                  <div className="flex justify-between text-sm">
                    <span className="font-bold">الصافي</span>
                    <span className="font-bold text-primary">
                      {formatMoney(isDraft ? payslip.net_amount - payslip.estimatedLoanDeduction : payslip.net_amount)}
                    </span>
                  </div>
                </div>

                {/* Project allocation card */}
                <div className="min-w-0 p-4 rounded-xl bg-background border border-border/50 shadow-sm">
                  <h3 className="font-semibold text-xs text-muted-foreground flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    توزيع المشاريع
                  </h3>
                  {isDraft ? (
                    <PayslipAllocationForm
                      payslipId={payslip.id}
                      baseAmount={payslip.base_amount}
                      projects={projects}
                      initialRows={allocations.map(a => ({
                        project_id: a.project_id,
                        allocation_type: a.allocation_type,
                        allocation_value: a.allocation_value,
                      }))}
                    />
                  ) : allocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">لا يوجد توزيع مسجل</p>
                  ) : (
                    <div className="space-y-1.5">
                      {allocations.map((a, i) => (
                        <div key={i} className="flex justify-between bg-muted/40 rounded-lg px-2.5 py-1.5 text-sm">
                          <span className="truncate">{a.project_name}</span>
                          <span className="font-medium shrink-0">{formatMoney(a.allocated_amount || 0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Allowances/deductions card */}
                <div className="min-w-0 p-4 rounded-xl bg-background border border-border/50 shadow-sm">
                  <h3 className="font-semibold text-xs text-muted-foreground flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    البدلات والخصومات
                  </h3>
                  {isDraft ? (
                    <PayslipComponentForm payslipId={payslip.id} components={components} />
                  ) : components.length === 0 ? (
                    <p className="text-xs text-muted-foreground">لا يوجد بدلات أو خصومات</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {components.map(c => (
                        <div key={c.id} className="flex justify-between py-1.5 text-sm">
                          <span className="truncate">{c.label}</span>
                          <span className={`font-medium shrink-0 ${c.component_type === 'deduction' ? 'text-destructive' : 'text-green-600'}`}>
                            {c.component_type === 'deduction' ? '-' : '+'}{formatMoney(c.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <Link href={`/salary/runs/${payslip.runId}/payslips/${payslip.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                فتح كصفحة كاملة
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="font-medium text-right hover:text-primary hover:underline">
        {payslip.employeeName}
      </button>
      {dialog}
    </>
  );
}
