import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { Wallet } from 'lucide-react';
import { AdvancePayButton } from './advance-pay-button';
import { AdvanceReceiveButton } from './advance-receive-button';
import { AssignPaymentButton } from '../settings/owners/[id]/statement/assign-payment-button';
import { TreasuryHistoryFilters } from '@/components/treasury/treasury-history-filters';
import { OwnerHistoryFilters } from '@/components/treasury/owner-history-filters';

import { getAllCustodyBalances, getAllOwnerCustodyBalances } from '@/lib/queries/expenses';
import { getBanks } from '@/lib/queries/banks';
import { DisburseCustodyModal } from '@/components/treasury/disburse-custody-modal';
import { DisburseOwnerCustodyModal } from '@/components/treasury/disburse-owner-custody-modal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'الخزينة والمدفوعات والعهد' };

export default async function TreasuryPage({ searchParams }: { searchParams: Promise<{ tab?: string, subtab?: string, vendor_id?: string, owner_id?: string, project_id?: string, start_date?: string, end_date?: string, show_all?: string }> }) {
  const { tab = 'payables', subtab = 'claims', vendor_id, owner_id, project_id, start_date, end_date, show_all } = await searchParams;
  const supabase = await createClient();

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const defaultStart = `${year}-${month}-01`;
  const defaultEnd = `${year}-${month}-${lastDay}`;

  const startDate = start_date || defaultStart;
  const endDate = end_date || defaultEnd;
  const isShowAll = show_all === 'true';

  let vendorHistoryQuery = supabase.from('ledger_entries')
      .select('id, entry_date, amount, memo, project_id, counterparty_id, bank_accounts(account_name, banks(name)), projects(name), payment_allocations(target_type, target_id, allocated_amount)')
      .eq('category', 'vendor_payment')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

  if (vendor_id) vendorHistoryQuery = vendorHistoryQuery.eq('counterparty_id', vendor_id);
  if (project_id && tab === 'payables') vendorHistoryQuery = vendorHistoryQuery.eq('project_id', project_id);
  if (!isShowAll && tab === 'payables') {
      vendorHistoryQuery = vendorHistoryQuery.gte('entry_date', startDate).lte('entry_date', endDate);
  }
  vendorHistoryQuery = vendorHistoryQuery.limit((isShowAll || start_date || end_date || vendor_id || project_id) && tab === 'payables' ? 200 : 20);

  let ownerHistoryQuery = supabase.from('ledger_entries')
      .select('id, entry_date, amount, memo, project_id, counterparty_id, bank_accounts(account_name, banks(name)), projects(name), payment_allocations(target_type, target_id, allocated_amount)')
      .eq('category', 'owner_payment')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

  if (owner_id) ownerHistoryQuery = ownerHistoryQuery.eq('counterparty_id', owner_id);
  if (project_id && tab === 'receivables') ownerHistoryQuery = ownerHistoryQuery.eq('project_id', project_id);
  if (!isShowAll && tab === 'receivables') {
      ownerHistoryQuery = ownerHistoryQuery.gte('entry_date', startDate).lte('entry_date', endDate);
  }
  ownerHistoryQuery = ownerHistoryQuery.limit((isShowAll || start_date || end_date || owner_id || project_id) && tab === 'receivables' ? 200 : 20);

  const [
    { data: vendors },
    { data: owners },
    { data: allContractors },
    { data: allOwners },
    { data: vendorHistory },
    { data: ownerHistory },
    { data: projects },
    { data: latestOwnerClaims },
    { data: latestClaimTotals },
    empCustodyBalances,
    ownerCustodyBalances,
    banks
  ] = await Promise.all([
    supabase.from('v_vendor_balances').select('vendor_id, vendor_name, gross_total, total_due, total_paid, balance, total_retention_held').order('balance', { ascending: false }),
    supabase.from('v_owner_balances').select('owner_id, owner_name, total_due, total_paid, balance').order('balance', { ascending: false }),
    supabase.from('vendors').select('id, name').order('name'),
    supabase.from('project_owners').select('id, name').order('name'),
    vendorHistoryQuery,
    ownerHistoryQuery,
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('v_latest_owner_claims').select('claim_id, claim_number, project_id, party_id'),
    supabase.from('v_claim_totals').select('claim_id, total_due_this_claim, claim_cumulative_retained'),
    tab === 'emp_custodies' ? getAllCustodyBalances() : Promise.resolve([]),
    tab === 'owner_custodies' ? getAllOwnerCustodyBalances() : Promise.resolve([]),
    tab === 'emp_custodies' || tab === 'owner_custodies' ? getBanks() : Promise.resolve([])
  ]);

  // Build retention map: owner_id → cumulative_retained (from latest approved owner claim)
  const retentionByOwner = new Map<string, number>();
  for (const lc of latestOwnerClaims || []) {
    const t = (latestClaimTotals || []).find((t: any) => t.claim_id === lc.claim_id);
    const existing = retentionByOwner.get(lc.party_id) || 0;
    retentionByOwner.set(lc.party_id, existing + Number((t as any)?.claim_cumulative_retained || 0));
  }

  // ── Invoices subtab: approved invoices with remaining balance ──
  let invoiceRows: any[] = [];
  if (tab === 'payables' && subtab === 'invoices') {
    const { data: approvedInvoices } = await supabase
      .from('invoices')
      .select('id, invoice_date, status, total, vendor_id, project_id, vendor:vendors(id, name), project:projects(name)')
      .eq('status', 'approved')
      .order('invoice_date', { ascending: false });

    if (approvedInvoices && approvedInvoices.length > 0) {
      const invoiceIds = approvedInvoices.map((i: any) => i.id);
      const { data: invoicePaid } = await supabase
        .from('v_invoice_paid')
        .select('invoice_id, paid_amount')
        .in('invoice_id', invoiceIds);

      invoiceRows = approvedInvoices
        .map((inv: any) => ({
          ...inv,
          paid_amount: Number((invoicePaid || []).find((p: any) => p.invoice_id === inv.id)?.paid_amount || 0),
          balance: inv.total - Number((invoicePaid || []).find((p: any) => p.invoice_id === inv.id)?.paid_amount || 0),
        }))
        .filter((inv: any) => inv.balance > 0);
    }
  }

  const totalsMap = new Map((latestClaimTotals ?? []).map(t => [t.claim_id, t.total_due_this_claim]));
  const openClaimsByOwner = new Map<string, { claim_id: string; claim_number: number; project_id: string; amount_due: number }[]>();
  for (const c of latestOwnerClaims ?? []) {
    const due = totalsMap.get(c.claim_id) ?? 0;
    if (due <= 0) continue;
    const arr = openClaimsByOwner.get(c.party_id) ?? [];
    arr.push({ claim_id: c.claim_id, claim_number: c.claim_number, project_id: c.project_id, amount_due: due });
    openClaimsByOwner.set(c.party_id, arr);
  }

  const contractorMap = new Map((allContractors ?? []).map(c => [c.id, c.name]));
  const ownerMap      = new Map((allOwners ?? []).map(o => [o.id, o.name]));

  const adjustedVendors = vendors || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between bg-card p-6 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-full">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">الخزينة والمدفوعات والعهد</h1>
            <p className="text-muted-foreground mt-1">إدارة الدفعات والمقبوضات والعهد للموظفين والملاك</p>
          </div>
        </div>
        {tab === 'payables' && <AdvancePayButton contractors={allContractors || []} />}
        {tab === 'receivables' && <AdvanceReceiveButton owners={allOwners || []} />}
        {tab === 'emp_custodies' && <DisburseCustodyModal employees={empCustodyBalances} banks={banks} />}
        {tab === 'owner_custodies' && <DisburseOwnerCustodyModal owners={allOwners || []} banks={banks} />}
      </div>

      <div className="flex gap-2 border-b overflow-x-auto pb-1">
        <Link href="/treasury?tab=payables" className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${tab === 'payables' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          المدفوعات (المقاولون)
        </Link>
        <Link href="/treasury?tab=receivables" className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${tab === 'receivables' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          المقبوضات (الملاك)
        </Link>
        <Link href="/treasury?tab=emp_custodies" className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${tab === 'emp_custodies' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          عهد الموظفين
        </Link>
        <Link href="/treasury?tab=owner_custodies" className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${tab === 'owner_custodies' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          عهد الملاك
        </Link>
      </div>

      {tab === 'payables' && (
        <div className="space-y-4">

          {/* ── Sub-tabs: المستخلصات / الفواتير ── */}
          <div className="flex gap-1 bg-muted/40 p-1 rounded-lg w-fit">
            <Link
              href={`/treasury?tab=payables&subtab=claims`}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                subtab !== 'invoices'
                  ? 'bg-card shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              📋 مستخلصات المقاولين
            </Link>
            <Link
              href={`/treasury?tab=payables&subtab=invoices`}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                subtab === 'invoices'
                  ? 'bg-card shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              🧾 فواتير الموردين
            </Link>
          </div>

          {/* ── CLAIMS sub-tab ── */}
          {subtab !== 'invoices' && (
        <div className="space-y-4">
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-4 font-medium">المقاول</th>
                  <th className="p-4 font-medium text-muted-foreground">إجمالي الأعمال التراكمي</th>
                  <th className="p-4 font-medium text-amber-600">المحتجز التراكمي (تأمين)</th>
                  <th className="p-4 font-medium">الصافي التراكمي (قابل للدفع)</th>
                  <th className="p-4 font-medium text-green-600">المدفوع</th>
                  <th className="p-4 font-medium text-primary">المتبقي المستحق</th>
                  <th className="p-4 font-medium w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adjustedVendors.map(v => {
                  const grossTotal    = Number((v as any).gross_total          || 0);
                  const retention     = Number((v as any).total_retention_held || 0);
                  const netCumulative = Number(v.total_due                    || 0);
                  const totalPaid     = Number(v.total_paid                   || 0);
                  const remaining     = Number(v.balance                      || 0);
                  return (
                    <tr key={v.vendor_id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-4 font-semibold">{v.vendor_name}</td>
                      <td className="p-4">{formatMoney(grossTotal)}</td>
                      <td className="p-4 text-amber-600">
                        {retention > 0 ? `- ${formatMoney(retention)}` : '-'}
                      </td>
                      <td className="p-4 font-medium">{formatMoney(netCumulative)}</td>
                      <td className="p-4 text-green-700">
                        {totalPaid > 0 ? `- ${formatMoney(totalPaid)}` : '-'}
                      </td>
                      <td className="p-4">
                        <span className={`font-bold ${remaining <= 0 ? 'text-green-600' : 'text-primary'}`}>
                          {remaining <= 0 ? '✓ مسدد' : formatMoney(remaining)}
                        </span>
                      </td>
                      <td className="p-4">
                        <Link href={`/vendors/${v.vendor_id}/statement`} className="text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-md font-medium">كشف حساب</Link>
                      </td>
                    </tr>
                  );
                })}
                {adjustedVendors.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">لا يوجد مقاولون بأرصدة مستحقة</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-8">
            <h2 className="text-lg font-bold mb-4">أحدث المدفوعات للمقاولين</h2>
            
            <TreasuryHistoryFilters 
              vendors={allContractors || []}
              projects={projects || []}
              selectedVendorId={vendor_id || ''}
              selectedProjectId={project_id || ''}
              startDate={startDate}
              endDate={endDate}
              showAll={isShowAll}
            />

            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <table className="w-full text-sm text-right">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="p-4 font-medium">التاريخ</th>
                    <th className="p-4 font-medium">المقاول</th>
                    <th className="p-4 font-medium">المشروع</th>
                    <th className="p-4 font-medium">الحساب البنكي / الخزينة</th>
                    <th className="p-4 font-medium">المبلغ</th>
                    <th className="p-4 font-medium">البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vendorHistory?.map(entry => (
                    <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-4">{entry.entry_date}</td>
                      <td className="p-4 font-semibold">{contractorMap.get(entry.counterparty_id) || 'غير معروف'}</td>
                      <td className="p-4 text-muted-foreground">{(entry.projects as any)?.name || '-'}</td>
                      <td className="p-4 text-muted-foreground">{(entry.bank_accounts as any)?.banks?.name || ''} - {(entry.bank_accounts as any)?.account_name || ''}</td>
                      <td className="p-4 font-bold text-destructive">{formatMoney(entry.amount)}</td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1">
                          {entry.memo && <span className="text-muted-foreground">{entry.memo}</span>}
                          {entry.payment_allocations && entry.payment_allocations.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {entry.payment_allocations.map((alloc: any, i: number) => (
                                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                                  {alloc.target_type === 'claim' ? 'مستخلص' : alloc.target_type === 'invoice' ? 'فاتورة' : alloc.target_type}
                                  {' • '}
                                  {formatMoney(alloc.allocated_amount)}
                                </span>
                              ))}
                            </div>
                          )}
                          {!entry.memo && (!entry.payment_allocations || entry.payment_allocations.length === 0) && (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(!vendorHistory || vendorHistory.length === 0) && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد مدفوعات مسجلة</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          )}

          {/* ── INVOICES sub-tab ── */}
          {subtab === 'invoices' && (
            <div className="space-y-4">
              <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
                <table className="w-full text-sm text-right">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="p-4 font-medium">المورد</th>
                      <th className="p-4 font-medium">المشروع</th>
                      <th className="p-4 font-medium">تاريخ الفاتورة</th>
                      <th className="p-4 font-medium">إجمالي الفاتورة</th>
                      <th className="p-4 font-medium text-green-600">المدفوع</th>
                      <th className="p-4 font-medium text-primary">المتبقي المستحق</th>
                      <th className="p-4 font-medium w-28"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {invoiceRows.map((inv: any) => (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4 font-semibold">{inv.vendor?.name || 'غير معروف'}</td>
                        <td className="p-4 text-muted-foreground">{inv.project?.name || '-'}</td>
                        <td className="p-4 text-muted-foreground">{inv.invoice_date}</td>
                        <td className="p-4">{formatMoney(inv.total)}</td>
                        <td className="p-4 text-green-700">
                          {inv.paid_amount > 0 ? `- ${formatMoney(inv.paid_amount)}` : '-'}
                        </td>
                        <td className="p-4">
                          <span className="font-bold text-primary">{formatMoney(inv.balance)}</span>
                        </td>
                        <td className="p-4">
                          <Link
                            href={`/treasury/pay/${inv.vendor_id}`}
                            className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-md font-medium whitespace-nowrap"
                          >
                            💸 دفع
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {invoiceRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-muted-foreground">لا توجد فواتير معتمدة برصيد متبقي</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'receivables' && (
        <div className="space-y-4">
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-4 font-medium">المالك</th>
                  <th className="p-4 font-medium text-amber-600">إجمالي المطلوب</th>
                  <th className="p-4 font-medium text-orange-500">المحتجز</th>
                  <th className="p-4 font-medium text-green-600">إجمالي المحصل</th>
                  <th className="p-4 font-medium text-primary">المتبقي (الرصيد)</th>
                  <th className="p-4 font-medium w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {owners?.map(o => (
                  <tr key={o.owner_id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-4 font-semibold">{o.owner_name}</td>
                    <td className="p-4">{formatMoney(o.total_due)}</td>
                    <td className="p-4 text-orange-600 font-medium">
                      {retentionByOwner.get(o.owner_id)
                        ? `- ${formatMoney(retentionByOwner.get(o.owner_id)!)}`
                        : '-'}
                    </td>
                    <td className="p-4 text-green-700 font-medium">{formatMoney(o.total_paid)}</td>
                    <td className="p-4 font-bold text-primary">{formatMoney(o.balance)}</td>
                    <td className="p-4 flex gap-2">
                      <Link href={`/settings/owners/${o.owner_id}/statement`} className="text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-md font-medium">كشف حساب</Link>
                      <Link href={`/treasury/receive/${o.owner_id}`} className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-md font-medium">تحصيل</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8">
            <h2 className="text-lg font-bold mb-4">أحدث المقبوضات من الملاك</h2>

            <OwnerHistoryFilters 
              owners={allOwners || []}
              projects={projects || []}
              selectedOwnerId={owner_id || ''}
              selectedProjectId={project_id || ''}
              startDate={startDate}
              endDate={endDate}
              showAll={isShowAll}
            />

            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <table className="w-full text-sm text-right">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="p-4 font-medium">التاريخ</th>
                    <th className="p-4 font-medium">المالك</th>
                    <th className="p-4 font-medium">المشروع</th>
                    <th className="p-4 font-medium">الحساب البنكي / الخزينة</th>
                    <th className="p-4 font-medium">المبلغ</th>
                    <th className="p-4 font-medium">البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ownerHistory?.map(entry => {
                    const isUnassigned = !entry.project_id || !(entry.payment_allocations as any[]).length;
                    const ownerOpenClaims = openClaimsByOwner.get(entry.counterparty_id) ?? [];
                    return (
                    <tr key={entry.id} className={`hover:bg-muted/30 transition-colors ${isUnassigned ? 'bg-amber-50/40' : ''}`}>
                      <td className="p-4">{entry.entry_date}</td>
                      <td className="p-4 font-semibold">{ownerMap.get(entry.counterparty_id) || 'غير معروف'}</td>
                      <td className="p-4">
                        {isUnassigned ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium"><span>🟡</span> غير محدد</span>
                        ) : (
                          <span className="text-muted-foreground">{(entry.projects as any)?.name || '-'}</span>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">{(entry.bank_accounts as any)?.banks?.name || ''} - {(entry.bank_accounts as any)?.account_name || ''}</td>
                      <td className="p-4 font-bold text-green-600">{formatMoney(entry.amount)}</td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1">
                          {entry.memo && <span className="text-muted-foreground">{entry.memo}</span>}
                          {(entry.payment_allocations as any[]).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(entry.payment_allocations as any[]).map((alloc: any, i: number) => (
                                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                                  {alloc.target_type === 'claim' ? 'مستخلص' : alloc.target_type === 'owner_schedule' ? 'دفعة متوقعة' : alloc.target_type}
                                  {' • '}
                                  {formatMoney(alloc.allocated_amount)}
                                </span>
                              ))}
                            </div>
                          )}
                          {isUnassigned && (
                            <div className="mt-1">
                              <AssignPaymentButton
                                ledgerEntryId={entry.id}
                                entryAmount={entry.amount}
                                openClaims={ownerOpenClaims}
                                projects={projects ?? []}
                              />
                            </div>
                          )}
                          {!entry.memo && !isUnassigned && (entry.payment_allocations as any[]).length === 0 && (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {(!ownerHistory || ownerHistory.length === 0) && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <span>لا توجد مقبوضات مسجلة في الفترة المحددة</span>
                          <span className="text-xs">
                            لتسجيل تحصيل جديد، اختر مالكاً من الجدول أعلاه واضغط &quot;تحصيل&quot;
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'emp_custodies' && (
        <div className="bg-card rounded-lg border shadow-sm divide-y divide-border">
          {empCustodyBalances.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">لا يوجد موظفين لديهم صلاحية العهد</div>
          ) : (
            empCustodyBalances.map((b: any) => (
              <div key={b.employee_id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-muted/20 transition-colors">
                <div>
                  <p className="font-bold">{b.full_name}</p>
                  <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-4">
                    <span>إجمالي المنصرف: <span className="font-medium text-foreground">{formatMoney(b.total_disbursed)}</span></span>
                    <span>العهد المسواة: <span className="font-medium text-foreground">{formatMoney(b.total_settled)}</span></span>
                    <span>المصروفات المعتمدة: <span className="font-medium text-foreground">{formatMoney(b.total_approved_expenses)}</span></span>
                  </div>
                </div>
                <div className="text-left flex flex-col sm:items-end">
                  <p className="text-xs text-muted-foreground mb-1">الرصيد المتبقي</p>
                  <div className={`text-xl font-bold whitespace-nowrap ${b.balance < 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {formatMoney(b.balance)}
                  </div>
                  <Link href={`/reports/employee-custody?employee_id=${b.employee_id}`} className="mt-2 text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-lg transition-colors hover:bg-primary/20">
                    التفاصيل / كشف العهدة
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'owner_custodies' && (
        <div className="bg-card rounded-lg border shadow-sm divide-y divide-border">
          {ownerCustodyBalances.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p className="text-base">لا يوجد ملاك لديهم عهد مفتوحة</p>
              <p className="text-sm mt-1">استخدم الزر في الأعلى لبدء صرف عهدة لمالك</p>
            </div>
          ) : (
            ownerCustodyBalances.map((b: any) => (
              <div key={b.owner_id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-muted/20 transition-colors">
                <div>
                  <p className="font-bold">{b.name}</p>
                  <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-4">
                    <span>إجمالي المنصرف: <span className="font-medium text-foreground">{formatMoney(b.total_disbursed)}</span></span>
                    <span>المصروفات المعتمدة: <span className="font-medium text-foreground">{formatMoney(b.total_approved_expenses)}</span></span>
                  </div>
                </div>
                <div className="text-left flex flex-col sm:items-end">
                  <p className="text-xs text-muted-foreground mb-1">الرصيد المتبقي</p>
                  <div className={`text-xl font-bold whitespace-nowrap ${b.balance < 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {formatMoney(b.balance)}
                  </div>
                  <Link href={`/settings/owners/${b.owner_id}/statement`} className="mt-2 text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-lg transition-colors hover:bg-primary/20">
                    التفاصيل / كشف الحساب
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
