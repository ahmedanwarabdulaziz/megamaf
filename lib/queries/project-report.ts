import { createClient } from '@/lib/supabase/server';
import { computeClaimFinancials } from '@/lib/claim-financials';

export interface ProjectReportData {
  project: any;
  finances: any;
  ownerClaims: any[];
  vendorClaims: any[];
  vendorClaimSummaries: any[];
  invoices: any[];
  employeeExpenses: any[];
  salaryAllocations: any[];
  retentionReleases: any[];
  vendorPriorClaims: any[];
  ownerSchedule: any[];
  cashMovements: any[];
}

const CATEGORY_LABELS: Record<string, string> = {
  opening_balance: 'رصيد افتتاحي',
  bank_in: 'إيداع بنكي',
  bank_out: 'سحب بنكي',
  custody_disbursement: 'صرف عهدة',
  vendor_payment: 'دفعة لمقاول/مورد',
  owner_payment: 'تحصيل من مالك',
  deposit_collection: 'تحصيل وديعة',
  interest: 'فوائد',
  deduction: 'خصم',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
};

export async function getProjectReportData(projectId: string): Promise<ProjectReportData | null> {
  const supabase = await createClient();

  const [
    { data: project },
    { data: finances },
    { data: claims },
    { data: invoices },
    { data: employeeExpensesRaw },
    { data: allocations },
    { data: retentionRaw },
    { data: vendorPriorClaimsRaw },
    { data: ownerSchedule },
    { data: ledgerRaw },
  ] = await Promise.all([
    supabase.from('projects').select('*, project_owners(id, name)').eq('id', projectId).single(),
    supabase.from('v_project_financial_position').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('claims').select('*').eq('project_id', projectId).order('claim_type').order('claim_number', { ascending: false }),
    supabase.from('invoices').select('*, vendors(name, kind)').eq('project_id', projectId).order('invoice_date', { ascending: false }),
    supabase.from('expenses').select('*, employees!expenses_employee_id_fkey(full_name), project_owners(name), expense_categories(name)').eq('project_id', projectId).eq('status', 'approved').order('expense_date', { ascending: false }),
    supabase.from('payslip_project_allocations').select('*').eq('project_id', projectId),
    supabase.from('retention_releases').select('*').eq('project_id', projectId).eq('claim_type', 'vendor').order('released_at', { ascending: false }),
    supabase.from('vendor_prior_claims').select('*, vendors(name, kind)').eq('project_id', projectId).order('created_at'),
    supabase.from('owner_payment_schedule').select('*').eq('project_id', projectId).order('due_date'),
    supabase.from('ledger_entries').select('*, bank_accounts(account_name)').eq('project_id', projectId).order('entry_date', { ascending: false }).limit(500),
  ]);

  if (!project) return null;

  const allClaims = claims || [];
  const ownerClaimsRaw = allClaims.filter((c: any) => c.claim_type === 'owner');
  const vendorClaimsRaw = allClaims.filter((c: any) => c.claim_type === 'vendor');
  const claimIds = allClaims.map((c: any) => c.id);
  const invoiceIds = (invoices || []).map((i: any) => i.id);
  const retentionIds = (retentionRaw || []).map((r: any) => r.id);
  const vendorPartyIds = Array.from(new Set(vendorClaimsRaw.map((c: any) => c.party_id)));
  const ownerPartyIds = Array.from(new Set(ownerClaimsRaw.map((c: any) => c.party_id)));
  const retentionPartyIds = Array.from(new Set((retentionRaw || []).map((r: any) => r.party_id)));

  const [
    { data: claimTotals },
    { data: invoicePaid },
    { data: retentionPaid },
    { data: vendorNames },
    { data: ownerNames },
  ] = await Promise.all([
    claimIds.length
      ? supabase.from('v_claim_totals').select('*').in('claim_id', claimIds)
      : Promise.resolve({ data: [] as any[] }),
    invoiceIds.length
      ? supabase.from('v_invoice_paid').select('*').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as any[] }),
    retentionIds.length
      ? supabase.from('v_retention_paid').select('*').in('retention_id', retentionIds)
      : Promise.resolve({ data: [] as any[] }),
    vendorPartyIds.length
      ? supabase.from('vendors').select('id, name, kind').in('id', vendorPartyIds)
      : Promise.resolve({ data: [] as any[] }),
    (ownerPartyIds.length || retentionPartyIds.length)
      ? supabase.from('project_owners').select('id, name').in('id', Array.from(new Set([...ownerPartyIds, ...retentionPartyIds])))
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const totalsByClaimId = new Map((claimTotals || []).map((t: any) => [t.claim_id, t]));
  const paidByInvoiceId = new Map((invoicePaid || []).map((p: any) => [p.invoice_id, p.paid_amount]));
  const paidByRetentionId = new Map((retentionPaid || []).map((p: any) => [p.retention_id, p.paid_amount]));
  const vendorNameById = new Map((vendorNames || []).map((v: any) => [v.id, v]));
  const ownerNameById = new Map((ownerNames || []).map((o: any) => [o.id, o.name]));

  const ownerClaims = ownerClaimsRaw.map((c: any) => ({
    ...c,
    party_name: ownerNameById.get(c.party_id) || project.project_owners?.name || '—',
    totals: totalsByClaimId.get(c.id) || null,
  }));

  const vendorClaims = vendorClaimsRaw.map((c: any) => ({
    ...c,
    party_name: vendorNameById.get(c.party_id)?.name || '—',
    party_kind: vendorNameById.get(c.party_id)?.kind,
    totals: totalsByClaimId.get(c.id) || null,
  }));

  const invoicesWithPaid = (invoices || []).map((i: any) => ({
    ...i,
    paid_amount: paidByInvoiceId.get(i.id) || 0,
  }));

  const employeeExpenses = (employeeExpensesRaw || []).map((e: any) => ({
    ...e,
    party_name: e.employees?.full_name || e.project_owners?.name || '—',
    category_name: e.expense_categories?.name || '—',
  }));

  const retentionReleases = (retentionRaw || []).map((r: any) => ({
    ...r,
    party_name: vendorNameById.get(r.party_id)?.name || ownerNameById.get(r.party_id) || '—',
    paid_amount: paidByRetentionId.get(r.id) || 0,
  }));

  const vendorPriorClaims = (vendorPriorClaimsRaw || []).map((v: any) => ({
    ...v,
    party_name: v.vendors?.name || '—',
    party_kind: v.vendors?.kind,
  }));

  // ── Vendor claim summaries: ONE row per vendor (latest claim), with the
  // exact same financials as /claims — computeClaimFinancials() fed by the
  // RAW ledger "paid" amount (not payment_allocations), matching the fix in
  // supabase/migrations/20260723120000_fix_vendor_balances_raw_paid.sql. ──
  const ledgerRowsForVendorPaid = ledgerRaw || [];
  const vendorLedgerPaidByParty = new Map<string, number>();
  for (const l of ledgerRowsForVendorPaid) {
    if (l.counterparty_type === 'vendor' && l.direction === 'out' && l.counterparty_id) {
      vendorLedgerPaidByParty.set(l.counterparty_id, (vendorLedgerPaidByParty.get(l.counterparty_id) || 0) + Number(l.amount || 0));
    }
  }
  const vendorPriorByPartyId = new Map((vendorPriorClaimsRaw || []).map((v: any) => [v.vendor_id, v]));

  const vendorGroups = new Map<string, typeof vendorClaims>();
  for (const c of vendorClaims) {
    if (!vendorGroups.has(c.party_id)) vendorGroups.set(c.party_id, []);
    vendorGroups.get(c.party_id)!.push(c);
  }

  const vendorClaimSummaries: any[] = [];
  for (const [partyId, group] of vendorGroups.entries()) {
    const latest = group[0]; // highest claim_number — query is already ordered DESC
    const claimZero = group.find((c: any) => c.claim_number === 0);
    const openingPaid = Number(claimZero?.opening_paid_amount || 0);
    const ledgerPaid = vendorLedgerPaidByParty.get(partyId) || 0;
    const vpc = vendorPriorByPartyId.get(partyId);

    const fin = computeClaimFinancials({
      claimCumulativeTotal: latest.totals?.claim_cumulative_total || 0,
      claimCumulativeRetained: latest.totals?.claim_cumulative_retained || 0,
      priorCertifiedAmount: Number(vpc?.prior_certified_amount || 0),
      priorRetentionHeld: Number(vpc?.prior_retention_held || 0),
      taxEnabled: !!latest.tax_enabled,
      taxRate: Number(latest.tax_rate || 0),
      paidInSystem: ledgerPaid + openingPaid,
      openingPaid: 0,
      claimNumber: latest.claim_number,
    });

    vendorClaimSummaries.push({
      party_id: partyId,
      party_name: latest.party_name,
      party_kind: latest.party_kind,
      claim_date: latest.claim_date,
      status: latest.status,
      is_prior_only: false,
      openingPaidDisplay: openingPaid,
      ...fin,
    });
  }

  // Vendors with ONLY a prior/opening-balance record and zero in-system claims
  for (const vpc of vendorPriorClaimsRaw || []) {
    if (vendorGroups.has(vpc.vendor_id)) continue;
    const grossTotal = Number(vpc.prior_certified_amount || 0);
    const retained = Number(vpc.prior_retention_held || 0);
    const totalPaid = Number(vpc.prior_paid_amount || 0);
    vendorClaimSummaries.push({
      party_id: vpc.vendor_id,
      party_name: vpc.vendors?.name || '—',
      party_kind: vpc.vendors?.kind,
      claim_number: 0,
      claim_date: vpc.cutoff_date,
      status: 'prior_only',
      is_prior_only: true,
      openingPaidDisplay: 0,
      grossTotal,
      retained,
      netCumulative: grossTotal - retained,
      tax: 0,
      totalDue: grossTotal - retained,
      totalPaid,
      remaining: (grossTotal - retained) - totalPaid,
    });
  }

  vendorClaimSummaries.sort((a, b) => (a.party_name || '').localeCompare(b.party_name || '', 'ar'));

  // ── Salary allocations: batch-resolve payslip + employee + payroll run ──
  let salaryAllocations: any[] = [];
  const allocRows = allocations || [];
  if (allocRows.length) {
    const payslipIds = Array.from(new Set(allocRows.map((a: any) => a.payslip_id)));
    const { data: payslips } = await supabase
      .from('payslips')
      .select('*, employees(full_name), payroll_runs(period_year, period_month)')
      .in('id', payslipIds)
      .in('status', ['approved', 'paid']);
    const payslipById = new Map((payslips || []).map((p: any) => [p.id, p]));
    salaryAllocations = allocRows
      .map((a: any) => {
        const ps = payslipById.get(a.payslip_id);
        if (!ps) return null;
        return {
          ...a,
          employee_name: ps.employees?.full_name || '—',
          period_year: ps.payroll_runs?.period_year,
          period_month: ps.payroll_runs?.period_month,
          payslip_status: ps.status,
          paid_at: ps.paid_at,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (b.period_year * 12 + b.period_month) - (a.period_year * 12 + a.period_month));
  }

  // ── Cash movements: batch-resolve counterparty names ──
  const ledgerRows = ledgerRaw || [];
  const vendorCpIds = Array.from(new Set(ledgerRows.filter((l: any) => l.counterparty_type === 'vendor').map((l: any) => l.counterparty_id)));
  const ownerCpIds = Array.from(new Set(ledgerRows.filter((l: any) => l.counterparty_type === 'owner').map((l: any) => l.counterparty_id)));
  const employeeCpIds = Array.from(new Set([
    ...ledgerRows.filter((l: any) => l.counterparty_type === 'employee').map((l: any) => l.counterparty_id),
    ...ledgerRows.filter((l: any) => l.employee_id).map((l: any) => l.employee_id),
  ]));

  const [
    { data: cpVendors },
    { data: cpOwners },
    { data: cpEmployees },
  ] = await Promise.all([
    vendorCpIds.length ? supabase.from('vendors').select('id, name').in('id', vendorCpIds) : Promise.resolve({ data: [] as any[] }),
    ownerCpIds.length ? supabase.from('project_owners').select('id, name').in('id', ownerCpIds) : Promise.resolve({ data: [] as any[] }),
    employeeCpIds.length ? supabase.from('employees').select('id, full_name').in('id', employeeCpIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const cpVendorById = new Map((cpVendors || []).map((v: any) => [v.id, v.name]));
  const cpOwnerById = new Map((cpOwners || []).map((o: any) => [o.id, o.name]));
  const cpEmployeeById = new Map((cpEmployees || []).map((e: any) => [e.id, e.full_name]));

  const cashMovements = ledgerRows.map((l: any) => {
    let counterpartyName = '—';
    if (l.counterparty_type === 'vendor') counterpartyName = cpVendorById.get(l.counterparty_id) || '—';
    else if (l.counterparty_type === 'owner') counterpartyName = cpOwnerById.get(l.counterparty_id) || '—';
    else if (l.counterparty_type === 'employee') counterpartyName = cpEmployeeById.get(l.counterparty_id) || '—';
    else if (l.employee_id) counterpartyName = cpEmployeeById.get(l.employee_id) || '—';

    return {
      ...l,
      category_label: CATEGORY_LABELS[l.category] || l.category,
      counterparty_name: counterpartyName,
      bank_account_name: l.bank_accounts?.account_name || '—',
    };
  });

  return {
    project,
    finances,
    ownerClaims,
    vendorClaims,
    vendorClaimSummaries,
    invoices: invoicesWithPaid,
    employeeExpenses,
    salaryAllocations,
    retentionReleases,
    vendorPriorClaims,
    ownerSchedule: ownerSchedule || [],
    cashMovements,
  };
}
