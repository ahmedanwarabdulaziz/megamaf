/**
 * computeClaimFinancials
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the vendor/owner claim financial summary.
 * Used on: /claims, /vendors, /treasury/pay/[vendorId], projects page.
 *
 * Key rules:
 * - `remaining` can be NEGATIVE — this means the vendor was overpaid.
 *   We no longer clamp with Math.max(0, …) so overpayments are surfaced.
 * - `openingPaid` (المدفوع قبل النظام from claim#0) IS subtracted from remaining
 *   along with in-system payments.
 */

export interface ClaimFinancials {
  /** Sum of all certified work (in-system + prior/claim#0) */
  grossTotal: number;
  /** Total retention held (in-system + prior) */
  retained: number;
  /** grossTotal − retained */
  netCumulative: number;
  /** VAT / tax amount */
  tax: number;
  /** Tax rate (e.g. 0.15 for 15%) */
  tax_rate: number;
  tax_enabled: boolean;
  /** Total certified amount due (netCumulative + tax) */
  totalDue: number;
  /** Paid via in-system treasury payments */
  paidInSystem: number;
  /** Paid before the system started (opening_paid_amount on claim#0) */
  openingPaid: number;
  /** paidInSystem + openingPaid */
  totalPaid: number;
  /**
   * Net amount still owed to the vendor.
   * NEGATIVE means the vendor was overpaid — show with a minus sign.
   * (We no longer clamp with Math.max(0, …))
   */
  remaining: number;
  /** Highest in-system claim number */
  claim_number: number;
}

export interface ClaimFinancialsInput {
  /** From v_claim_totals */
  claimCumulativeTotal: number;
  claimCumulativeRetained: number;
  /** From vendor_prior_claims (claim#0 legacy table) */
  priorCertifiedAmount: number;
  priorRetentionHeld: number;
  /** Tax settings from the latest approved claim */
  taxEnabled: boolean;
  taxRate: number;
  /** Paid via treasury (in-system) — sum across ALL claims for this vendor+project */
  paidInSystem: number;
  /** المدفوع قبل النظام — from claims.opening_paid_amount (claim#0 row) */
  openingPaid: number;
  /** Highest in-system claim number for display */
  claimNumber: number;
}

export function computeClaimFinancials(input: ClaimFinancialsInput): ClaimFinancials {
  const {
    claimCumulativeTotal,
    claimCumulativeRetained,
    priorCertifiedAmount,
    priorRetentionHeld,
    taxEnabled,
    taxRate,
    paidInSystem,
    openingPaid,
    claimNumber,
  } = input;

  const grossTotal    = claimCumulativeTotal    + priorCertifiedAmount;
  const retained      = claimCumulativeRetained + priorRetentionHeld;
  const netCumulative = grossTotal - retained;
  const tax           = taxEnabled ? netCumulative * taxRate : 0;
  const totalDue      = netCumulative + tax;
  const totalPaid     = paidInSystem + openingPaid;

  // NOTE: remaining is NOT clamped to 0.
  // A negative value means the vendor received more than they are owed (overpayment).
  const remaining = totalDue - totalPaid;

  return {
    grossTotal,
    retained,
    netCumulative,
    tax,
    tax_rate: taxRate,
    tax_enabled: taxEnabled,
    totalDue,
    paidInSystem,
    openingPaid,
    totalPaid,
    remaining,
    claim_number: claimNumber,
  };
}

/** Format the remaining balance label in Arabic */
export function remainingLabel(remaining: number): string {
  if (remaining < 0)  return '⚠️ مبلغ مسترد (دُفع زيادة)';
  if (remaining === 0) return '✓ تم السداد بالكامل';
  return 'المتبقي المستحق:';
}

/** CSS color class for the remaining balance */
export function remainingColorClass(remaining: number): string {
  if (remaining < 0)  return 'text-red-600 dark:text-red-400';
  if (remaining === 0) return 'text-green-600 dark:text-green-400';
  return 'text-primary';
}
