'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { exportToCsv } from '@/lib/export';
import { Download } from 'lucide-react';
import type { ProjectReportData } from '@/lib/queries/project-report';
import { remainingColorClass, remainingLabel } from '@/lib/claim-financials';

function StatCard({ label, value, tone = 'default', hint, isRemaining }: { label: string; value: number; tone?: 'default' | 'good' | 'bad' | 'muted'; hint?: string; isRemaining?: boolean }) {
  const toneClass =
    tone === 'good' ? 'text-green-600' :
    tone === 'bad' ? 'text-destructive' :
    tone === 'muted' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {isRemaining ? (
          <p className="text-lg font-bold"><RemainingAmount value={value} /></p>
        ) : (
          <p className={`text-lg font-bold ${toneClass}`}>{formatMoney(value)}</p>
        )}
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Tone for a "remaining" figure: negative = overpaid/credit (good news), 0 = settled, positive = still owed. */
function remainingTone(value: number): 'good' | 'muted' | 'default' {
  if (value < 0) return 'good';
  if (value === 0) return 'muted';
  return 'default';
}

/** Renders a remaining/outstanding amount, surfacing overpayment as a credit instead of clamping to 0. */
function RemainingAmount({ value, bold }: { value: number; bold?: boolean }) {
  if (value < 0) {
    return (
      <span className={`text-green-600 ${bold ? 'font-medium' : ''}`}>
        {formatMoney(Math.abs(value))} <span className="text-[11px] font-normal">(دائن)</span>
      </span>
    );
  }
  return <span className={bold ? 'font-medium' : ''}>{formatMoney(value)}</span>;
}

interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  csv?: (row: T) => string | number;
  align?: 'right' | 'left' | 'center';
}

function ReportSection<T>({
  title, icon, rows, columns, csvName, emptyText, defaultOpen, badges,
}: {
  title: string;
  icon?: React.ReactNode;
  rows: T[];
  columns: Column<T>[];
  csvName: string;
  emptyText: string;
  defaultOpen?: boolean;
  badges?: React.ReactNode;
}) {
  const handleExport = () => {
    const csvRows = rows.map(row => {
      const out: Record<string, string | number> = {};
      columns.forEach(c => { out[c.header] = c.csv ? c.csv(row) : ''; });
      return out;
    });
    exportToCsv(csvName, csvRows);
  };

  return (
    <CollapsibleSection
      title={title}
      icon={icon}
      defaultOpen={defaultOpen}
      badges={
        <>
          <span className="text-xs text-muted-foreground">{rows.length} سجل</span>
          {badges}
          {rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleExport(); }}>
              <Download className="w-3.5 h-3.5 ml-1.5" /> CSV
            </Button>
          )}
        </>
      }
    >
      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right whitespace-nowrap">
            <thead className="bg-muted/50 border-b">
              <tr>
                {columns.map((c, i) => (
                  <th key={i} className={`p-2.5 font-medium text-${c.align || 'right'}`}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  {columns.map((c, j) => (
                    <td key={j} className={`p-2.5 text-${c.align || 'right'}`}>{c.cell(row)}</td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="p-6 text-center text-muted-foreground">{emptyText}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </CollapsibleSection>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: 'bg-primary text-primary-foreground',
    paid: 'bg-primary text-primary-foreground',
    pending: 'bg-secondary text-secondary-foreground',
    partial: 'bg-amber-100 text-amber-800',
    expected: 'bg-secondary text-secondary-foreground',
    rejected: 'bg-destructive text-destructive-foreground',
    draft: 'bg-secondary text-secondary-foreground',
  };
  const labels: Record<string, string> = {
    approved: 'معتمد', paid: 'مدفوع', pending: 'قيد المراجعة', partial: 'جزئي',
    expected: 'متوقع', rejected: 'مرفوض', draft: 'مسودة', prior_only: 'تاريخي (قبل النظام)',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] || 'bg-muted text-muted-foreground'}`}>{labels[status] || status}</span>;
}

export function ProjectReport({ data }: { data: ProjectReportData }) {
  const f = data.finances || {};

  // ── Corrected accrual totals ──────────────────────────────────────────────
  // v_project_financial_position's own `total_income`/`total_expenses`/`balance`
  // columns sum each party's *latest claim only* (an incremental "what's new
  // since the last claim" amount), which silently drops every earlier claim
  // once a party has more than one. `total_expenses` also never folds in the
  // generic opening-balance `prior_expenses` figure. The already-shipped
  // project list cards (app/(app)/projects/_components/project-card.tsx) work
  // around the exact same issue — this mirrors that exact formula (both the
  // gross/billed totals AND the retention-net "payable" used for remaining
  // amounts) instead of the raw (buggy) view columns, so the numbers here
  // reconcile with /projects without needing a database migration.
  const ownerGross = (f.owner_claims_gross || 0) + (f.prior_owner_dues || 0);
  const ownerBilled = ownerGross > 0 ? ownerGross : (f.total_income || 0);
  const ownerCollected = f.owner_total_collected || 0;
  const ownerTax = f.owner_claims_tax || 0;
  const ownerPayable = (f.owner_claims_payable || f.total_income || 0) + ownerTax;
  // Not clamped to 0: a negative value means the party has been paid ahead of
  // what's currently certified/payable (an advance or overpayment) — shown as
  // a credit rather than hidden.
  const ownerOutstanding = ownerPayable - ownerCollected;

  const vendorGross = (f.vendor_claims_gross || 0) + (f.prior_vendor_certified || 0);
  const priorPayable = (f.prior_vendor_certified || 0) - (f.prior_vendor_retention || 0);
  const vendorTax = f.vendor_claims_tax || 0;
  const vendorPayable = (f.vendor_claims_payable || 0) + priorPayable + vendorTax;
  const vendorPaid = (f.vendor_claims_paid || 0) + (f.prior_vendor_paid || 0);
  const vendorOutstanding = vendorPayable - vendorPaid;

  const invoicesBilled = f.invoices_billed || 0;
  const invoicesPaid = f.invoices_paid || 0;
  const empExpBilled = f.employee_expenses_billed || 0;
  const empExpPaid = f.employee_expenses_paid || 0;
  const salaryBilled = f.employee_salary_cost_billed || 0;
  const salaryPaid = f.employee_salary_cost_paid || 0;
  const priorExpenses = f.prior_expenses || 0;

  // Gross basis — matches the P&L headline on /projects (project-card.tsx netProfit)
  const totalExpBilled = priorExpenses + vendorGross + invoicesBilled + empExpBilled + salaryBilled;
  const inventoryValue = f.inventory_asset_value || 0;
  const balance = ownerBilled - (totalExpBilled - inventoryValue);

  // Payable (retention-net) basis — matches the "remaining to pay/collect" on /projects
  const totalCostsPayable = vendorPayable + invoicesBilled + empExpBilled + salaryBilled;
  const totalCostsPaidNarrow = vendorPaid + invoicesPaid + empExpPaid + salaryPaid;
  const costsOutstanding = totalCostsPayable - totalCostsPaidNarrow;

  const cashNet = ownerCollected - (f.total_cash_paid || 0);

  const handleExportSummary = () => {
    exportToCsv(`ملخص_مالي_${data.project.name}`, [{
      'المشروع': data.project.name,
      'إجمالي الإيرادات': ownerGross,
      'المحصل من المالك': ownerCollected,
      'المتبقي على المالك': ownerOutstanding,
      'إجمالي التكاليف': totalExpBilled,
      'المدفوع من التكاليف': totalCostsPaidNarrow,
      'المتبقي من التكاليف': costsOutstanding,
      'صافي الموقف': balance,
      'المحتجزات الحالية': f.current_retention_held || 0,
      'صافي التدفق النقدي': cashNet,
      'قيمة المخزون': inventoryValue,
    }]);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" onClick={handleExportSummary}>
          <Download className="w-4 h-4 ml-2" /> تصدير الملخص CSV
        </Button>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="إجمالي الإيرادات" value={ownerGross} tone="good" />
        <StatCard label="المحصّل من المالك" value={ownerCollected} tone="good" />
        <StatCard label="المتبقي على المالك" value={ownerOutstanding} tone={remainingTone(ownerOutstanding)} isRemaining />
        <StatCard label="إجمالي التكاليف" value={totalExpBilled} tone="bad" />
        <StatCard label="المدفوع من التكاليف" value={totalCostsPaidNarrow} tone="bad" />
        <StatCard label="المتبقي من التكاليف (بعد خصم الضمان)" value={costsOutstanding} tone={remainingTone(costsOutstanding)} isRemaining />
        <StatCard label="المحتجزات الحالية" value={f.current_retention_held || 0} />
        <StatCard label="صافي التدفق النقدي" value={cashNet} tone={cashNet >= 0 ? 'good' : 'bad'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">الرصيد (الإيرادات - التكاليف + المخزون)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${balance >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {formatMoney(balance)}
            </p>
          </CardContent>
        </Card>
        {inventoryValue > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">قيمة المخزون الحالي (أصل)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold text-primary">{formatMoney(inventoryValue)}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {f.has_opening_balance && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4">
          <h3 className="font-semibold text-sm text-amber-800 dark:text-amber-200 mb-3">
            ⚖️ رصيد افتتاحي — تاريخ التقطيع: {f.opening_cutoff_date}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div className="bg-white dark:bg-card rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-muted-foreground mb-0.5">مستحقات المالك السابقة</p>
              <p className="font-bold">{formatMoney(f.prior_owner_dues || 0)}</p>
            </div>
            <div className="bg-white dark:bg-card rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-muted-foreground mb-0.5">إيرادات محصّلة سابقاً</p>
              <p className="font-bold text-green-600">{formatMoney(f.prior_owner_income || 0)}</p>
            </div>
            <div className="bg-white dark:bg-card rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-muted-foreground mb-0.5">مصروفات سابقة</p>
              <p className="font-bold text-destructive">{formatMoney(f.prior_expenses || 0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Category breakdown ── */}
      <div>
        <h2 className="font-bold text-base mb-3">التوزيع حسب الفئة</h2>
        <p className="text-xs text-muted-foreground mb-2">* عمود &quot;المتبقي&quot; محسوب بعد خصم الضمان المحتجز (نفس أساس صفحة المشاريع)، بينما &quot;المستحق/المفوتر&quot; إجمالي قبل خصم الضمان. إذا كان المدفوع أكبر من المستحق يظهر المتبقي كـ &quot;دائن&quot;.</p>
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right whitespace-nowrap">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 font-medium">الفئة</th>
                  <th className="p-3 font-medium">المستحق/المفوتر</th>
                  <th className="p-3 font-medium">المدفوع/المحصّل</th>
                  <th className="p-3 font-medium">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-green-50/40 dark:bg-green-950/10">
                  <td className="p-3 font-medium">
                    مستخلصات المالك
                    {(f.prior_owner_dues || 0) > 0 && <span className="block text-[11px] font-normal text-muted-foreground">يشمل {formatMoney(f.prior_owner_dues)} رصيد افتتاحي</span>}
                  </td>
                  <td className="p-3">{formatMoney(ownerGross)}</td>
                  <td className="p-3">{formatMoney(ownerCollected)}</td>
                  <td className="p-3"><RemainingAmount value={ownerOutstanding} bold /></td>
                </tr>
                <tr>
                  <td className="p-3">
                    مستخلصات الموردين/المقاولين
                    {(f.prior_vendor_certified || 0) > 0 && <span className="block text-[11px] font-normal text-muted-foreground">يشمل {formatMoney(f.prior_vendor_certified)} رصيد افتتاحي</span>}
                  </td>
                  <td className="p-3">{formatMoney(vendorGross)}</td>
                  <td className="p-3">{formatMoney(vendorPaid)}</td>
                  <td className="p-3"><RemainingAmount value={vendorOutstanding} bold /></td>
                </tr>
                <tr>
                  <td className="p-3">الفواتير</td>
                  <td className="p-3">{formatMoney(invoicesBilled)}</td>
                  <td className="p-3">{formatMoney(invoicesPaid)}</td>
                  <td className="p-3"><RemainingAmount value={invoicesBilled - invoicesPaid} /></td>
                </tr>
                <tr>
                  <td className="p-3">مصروفات الموظفين والمالك</td>
                  <td className="p-3">{formatMoney(empExpBilled)}</td>
                  <td className="p-3">{formatMoney(empExpPaid)}</td>
                  <td className="p-3"><RemainingAmount value={empExpBilled - empExpPaid} /></td>
                </tr>
                <tr>
                  <td className="p-3">تكلفة الرواتب</td>
                  <td className="p-3">{formatMoney(salaryBilled)}</td>
                  <td className="p-3">{formatMoney(salaryPaid)}</td>
                  <td className="p-3"><RemainingAmount value={salaryBilled - salaryPaid} /></td>
                </tr>
                {priorExpenses > 0 && (
                  <tr className="bg-amber-50/40 dark:bg-amber-950/10">
                    <td className="p-3">مصروفات سابقة عامة (رصيد افتتاحي)</td>
                    <td className="p-3">{formatMoney(priorExpenses)}</td>
                    <td className="p-3 text-muted-foreground">—</td>
                    <td className="p-3 text-muted-foreground">—</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t-2 bg-muted/30 font-bold">
                <tr>
                  <td className="p-3">الإجمالي (تكاليف)</td>
                  <td className="p-3">{formatMoney(totalExpBilled)}</td>
                  <td className="p-3">{formatMoney(totalCostsPaidNarrow)}</td>
                  <td className="p-3"><RemainingAmount value={costsOutstanding} bold /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* ── Detail sections ── */}
      <div>
        <h2 className="font-bold text-base mb-3">التفاصيل الكاملة</h2>
        <div className="space-y-3">

          <ReportSection
            title="مستخلصات المالك"
            rows={data.ownerClaims}
            csvName={`مستخلصات_المالك_${data.project.name}`}
            emptyText="لا يوجد مستخلصات مالك مسجلة"
            columns={[
              { header: 'رقم المستخلص', cell: r => r.claim_number === 0 ? 'رصيد افتتاحي (#0)' : `#${r.claim_number}`, csv: r => r.claim_number },
              { header: 'التاريخ', cell: r => r.claim_date, csv: r => r.claim_date },
              { header: 'الحالة', cell: r => <StatusBadge status={r.status} />, csv: r => r.status },
              { header: 'الإجمالي التراكمي', cell: r => formatMoney(r.totals?.claim_cumulative_total || 0), csv: r => r.totals?.claim_cumulative_total || 0 },
              { header: 'المحتجز', cell: r => formatMoney(r.totals?.claim_cumulative_retained || 0), csv: r => r.totals?.claim_cumulative_retained || 0 },
              { header: 'الضريبة', cell: r => formatMoney(r.totals?.tax_amount || 0), csv: r => r.totals?.tax_amount || 0 },
              { header: 'صافي المستحق', cell: r => <span className="font-medium">{formatMoney(r.totals?.total_due_this_claim || 0)}</span>, csv: r => r.totals?.total_due_this_claim || 0 },
            ]}
          />

          <ReportSection
            title="مستخلصات الموردين والمقاولين (آخر مستخلص لكل جهة)"
            rows={data.vendorClaimSummaries}
            csvName={`مستخلصات_الموردين_${data.project.name}`}
            emptyText="لا يوجد مستخلصات موردين مسجلة"
            columns={[
              { header: 'المورد/المقاول', cell: r => r.party_name, csv: r => r.party_name },
              { header: 'النوع', cell: r => r.party_kind === 'contractor' ? 'مقاول' : 'مورد', csv: r => r.party_kind },
              { header: 'آخر مستخلص', cell: r => r.is_prior_only ? 'رصيد افتتاحي فقط' : (r.claim_number === 0 ? 'رصيد افتتاحي (#0)' : `#${r.claim_number}`), csv: r => r.is_prior_only ? 'prior_only' : r.claim_number },
              { header: 'التاريخ', cell: r => r.claim_date, csv: r => r.claim_date },
              { header: 'الحالة', cell: r => <StatusBadge status={r.status} />, csv: r => r.status },
              { header: 'الإجمالي التراكمي', cell: r => formatMoney(r.grossTotal || 0), csv: r => r.grossTotal || 0 },
              { header: 'المحتجز', cell: r => r.retained > 0 ? formatMoney(r.retained) : '-', csv: r => r.retained || 0 },
              {
                header: 'إجمالي المستحق',
                cell: r => (
                  <div>
                    {formatMoney(r.totalDue || 0)}
                    {(r.tax || 0) > 0 && <div className="text-[11px] font-normal text-muted-foreground">شامل ضريبة {formatMoney(r.tax)}</div>}
                  </div>
                ),
                csv: r => r.totalDue || 0,
              },
              {
                header: 'المدفوع',
                cell: r => (
                  <div className="text-green-700 dark:text-green-400 font-medium">
                    {formatMoney(r.totalPaid || 0)}
                    {(r.openingPaidDisplay || 0) > 0 && <div className="text-[11px] font-normal text-amber-600 dark:text-amber-500">منها {formatMoney(r.openingPaidDisplay)} قبل النظام</div>}
                  </div>
                ),
                csv: r => r.totalPaid || 0,
              },
              {
                header: 'المتبقي',
                cell: r => (
                  <div>
                    <div className={`font-bold ${remainingColorClass(r.remaining || 0)}`}>
                      {(r.remaining || 0) < 0 ? `(${formatMoney(Math.abs(r.remaining))})` : formatMoney(r.remaining || 0)}
                    </div>
                    <div className="text-[11px] font-normal text-muted-foreground">{remainingLabel(r.remaining || 0)}</div>
                  </div>
                ),
                csv: r => r.remaining || 0,
              },
            ]}
          />

          <ReportSection
            title="الفواتير"
            rows={data.invoices}
            csvName={`الفواتير_${data.project.name}`}
            emptyText="لا يوجد فواتير مسجلة"
            columns={[
              { header: 'المورد', cell: r => r.vendors?.name || '—', csv: r => r.vendors?.name || '' },
              { header: 'رقم الفاتورة', cell: r => r.invoice_number || '—', csv: r => r.invoice_number || '' },
              { header: 'التاريخ', cell: r => r.invoice_date, csv: r => r.invoice_date },
              { header: 'الحالة', cell: r => <StatusBadge status={r.status} />, csv: r => r.status },
              { header: 'الإجمالي', cell: r => formatMoney(r.total || 0), csv: r => r.total || 0 },
              { header: 'المدفوع', cell: r => formatMoney(r.paid_amount || 0), csv: r => r.paid_amount || 0 },
              { header: 'المتبقي', cell: r => <span className="font-medium">{formatMoney(Math.max((r.total || 0) - (r.paid_amount || 0), 0))}</span>, csv: r => Math.max((r.total || 0) - (r.paid_amount || 0), 0) },
            ]}
          />

          <ReportSection
            title="مصروفات الموظفين والمالك"
            rows={data.employeeExpenses}
            csvName={`المصروفات_${data.project.name}`}
            emptyText="لا يوجد مصروفات معتمدة مسجلة"
            columns={[
              { header: 'الجهة', cell: r => r.party_name, csv: r => r.party_name },
              { header: 'الفئة', cell: r => r.category_name, csv: r => r.category_name },
              { header: 'التاريخ', cell: r => r.expense_date, csv: r => r.expense_date },
              { header: 'المبلغ', cell: r => formatMoney(r.amount || 0), csv: r => r.amount || 0 },
              { header: 'المسوّى', cell: r => formatMoney(r.settled_amount || 0), csv: r => r.settled_amount || 0 },
              { header: 'مباشر', cell: r => r.is_direct ? 'نعم' : 'لا', csv: r => r.is_direct ? 'نعم' : 'لا' },
            ]}
          />

          <ReportSection
            title="تكلفة الرواتب المخصصة للمشروع"
            rows={data.salaryAllocations}
            csvName={`الرواتب_${data.project.name}`}
            emptyText="لا يوجد تكاليف رواتب مخصصة لهذا المشروع"
            columns={[
              { header: 'الموظف', cell: r => r.employee_name, csv: r => r.employee_name },
              { header: 'الفترة', cell: r => `${r.period_month}/${r.period_year}`, csv: r => `${r.period_month}/${r.period_year}` },
              { header: 'الحالة', cell: r => <StatusBadge status={r.payslip_status} />, csv: r => r.payslip_status },
              { header: 'نوع التخصيص', cell: r => r.allocation_type === 'percentage' ? `${r.allocation_value}%` : 'مبلغ ثابت', csv: r => r.allocation_type },
              { header: 'المبلغ المخصص', cell: r => <span className="font-medium">{formatMoney(r.allocated_amount || 0)}</span>, csv: r => r.allocated_amount || 0 },
            ]}
          />

          {data.vendorPriorClaims.length > 0 && (
            <ReportSection
              title="أعمال موردين سابقة للنظام (رصيد افتتاحي)"
              rows={data.vendorPriorClaims}
              csvName={`أعمال_سابقة_${data.project.name}`}
              emptyText="لا يوجد أعمال سابقة مسجلة"
              columns={[
                { header: 'المورد/المقاول', cell: r => r.party_name, csv: r => r.party_name },
                { header: 'تاريخ القطع', cell: r => r.cutoff_date, csv: r => r.cutoff_date },
                { header: 'الأعمال المعتمدة سابقاً', cell: r => formatMoney(r.prior_certified_amount || 0), csv: r => r.prior_certified_amount || 0 },
                { header: 'المدفوع سابقاً', cell: r => formatMoney(r.prior_paid_amount || 0), csv: r => r.prior_paid_amount || 0 },
                { header: 'المحتجز سابقاً', cell: r => formatMoney(r.prior_retention_held || 0), csv: r => r.prior_retention_held || 0 },
              ]}
            />
          )}

          {data.retentionReleases.length > 0 && (
            <ReportSection
              title="الإفراج عن المحتجزات"
              rows={data.retentionReleases}
              csvName={`الإفراج_عن_المحتجزات_${data.project.name}`}
              emptyText="لا يوجد إفراج عن محتجزات مسجل"
              columns={[
                { header: 'المورد/المقاول', cell: r => r.party_name, csv: r => r.party_name },
                { header: 'تاريخ الإفراج', cell: r => r.released_at?.slice(0, 10), csv: r => r.released_at?.slice(0, 10) },
                { header: 'المبلغ المفرج عنه', cell: r => formatMoney(r.amount || 0), csv: r => r.amount || 0 },
                { header: 'المدفوع منه', cell: r => formatMoney(r.paid_amount || 0), csv: r => r.paid_amount || 0 },
              ]}
            />
          )}

          <ReportSection
            title="جدول الدفعات المتوقعة من المالك"
            rows={data.ownerSchedule}
            csvName={`جدول_الدفعات_${data.project.name}`}
            emptyText="لا يوجد دفعات متوقعة مسجلة"
            columns={[
              { header: 'تاريخ الاستحقاق', cell: r => r.due_date, csv: r => r.due_date },
              { header: 'المبلغ المتوقع', cell: r => formatMoney(r.expected_amount || 0), csv: r => r.expected_amount || 0 },
              { header: 'طريقة الدفع', cell: r => r.method || '—', csv: r => r.method || '' },
              { header: 'الحالة', cell: r => <StatusBadge status={r.status} />, csv: r => r.status },
              { header: 'ملاحظات', cell: r => r.notes || '—', csv: r => r.notes || '' },
            ]}
          />

          <ReportSection
            title="الحركة النقدية (الخزينة)"
            rows={data.cashMovements}
            csvName={`الحركة_النقدية_${data.project.name}`}
            emptyText="لا يوجد حركات نقدية مسجلة"
            columns={[
              { header: 'التاريخ', cell: r => r.entry_date, csv: r => r.entry_date },
              {
                header: 'الاتجاه',
                cell: r => (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.direction === 'in' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {r.direction === 'in' ? 'وارد' : 'صادر'}
                  </span>
                ),
                csv: r => r.direction === 'in' ? 'وارد' : 'صادر',
              },
              { header: 'الفئة', cell: r => r.category_label, csv: r => r.category_label },
              { header: 'الطرف الآخر', cell: r => r.counterparty_name, csv: r => r.counterparty_name },
              { header: 'الحساب البنكي', cell: r => r.bank_account_name, csv: r => r.bank_account_name },
              { header: 'المبلغ', cell: r => <span className="font-medium">{formatMoney(r.amount || 0)}</span>, csv: r => r.amount || 0 },
              { header: 'ملاحظات', cell: r => r.memo || '—', csv: r => r.memo || '' },
            ]}
          />

        </div>
      </div>
    </div>
  );
}
