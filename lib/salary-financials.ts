/**
 * Pure financial-math helpers for the salary/payroll module.
 * Mirrors lib/claim-financials.ts — no side effects, no DB access.
 */

export interface PayslipFinancials {
  grossAmount: number;
  netAmount: number;
}

export interface PayslipFinancialsInput {
  baseAmount: number;
  allowancesTotal: number;
  bonusTotal: number;
  deductionsTotal: number;
  loanDeductionTotal: number;
}

/** Client-side preview only — the RPC-computed snapshot on the payslip row is authoritative. */
export function computePayslipFinancials(input: PayslipFinancialsInput): PayslipFinancials {
  const { baseAmount, allowancesTotal, bonusTotal, deductionsTotal, loanDeductionTotal } = input;
  const grossAmount = baseAmount + allowancesTotal + bonusTotal;
  const netAmount = grossAmount - deductionsTotal - loanDeductionTotal;
  return { grossAmount, netAmount };
}

/** How much of a payslip's net pay is still owed, across any number of partial bank/expense payments. */
export function computePayslipRemaining(input: { netAmount: number; paidAmount: number }): number {
  return input.netAmount - input.paidAmount;
}

export interface LoanFinancials {
  remaining: number;
}

export interface LoanFinancialsInput {
  principalAmount: number;
  totalRepaid: number;
}

export function computeLoanFinancials(input: LoanFinancialsInput): LoanFinancials {
  const { principalAmount, totalRepaid } = input;
  return { remaining: principalAmount - totalRepaid };
}

/** Loan remaining balance label in Arabic */
export function loanRemainingLabel(remaining: number): string {
  if (remaining <= 0) return '✓ تم السداد بالكامل';
  return 'المتبقي من السلفة:';
}

/** CSS color class for the loan remaining balance */
export function loanRemainingColorClass(remaining: number): string {
  if (remaining <= 0) return 'text-green-600 dark:text-green-400';
  return 'text-primary';
}

const PAYSLIP_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  approved: 'معتمد',
  paid: 'مدفوع',
};

export function payslipStatusLabel(status: string): string {
  return PAYSLIP_STATUS_LABELS[status] ?? status;
}

const PAYROLL_RUN_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  approved: 'معتمد',
  paid: 'مدفوع بالكامل',
};

export function payrollRunStatusLabel(status: string): string {
  return PAYROLL_RUN_STATUS_LABELS[status] ?? status;
}

const LOAN_STATUS_LABELS: Record<string, string> = {
  active: 'قائمة',
  completed: 'مسددة بالكامل',
  cancelled: 'ملغاة',
};

export function loanStatusLabel(status: string): string {
  return LOAN_STATUS_LABELS[status] ?? status;
}
