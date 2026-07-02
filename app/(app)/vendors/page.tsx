import { getVendorsWithSummary } from '@/lib/queries/vendors';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { createClient } from '@/lib/supabase/server';
import { VendorModal } from '@/components/vendors/vendor-modal';
import { VendorsFilters } from '@/components/vendors/vendors-filters';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { requirePageAccess } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'المقاولين والموردين',
};

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string, kind?: string, search?: string, start_date?: string, end_date?: string, show_all?: string, subtab?: string }>;
}) {
  const { project_id, kind, search, start_date, end_date, show_all, subtab = 'claims' } = await searchParams;
  await requirePageAccess('vendors');
  const { profile } = await getProfile();
  if (!profile) return null;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const defaultStart = `${year}-${month}-01`;
  const defaultEnd = `${year}-${month}-${lastDay}`;

  const startDate = start_date || defaultStart;
  const endDate = end_date || defaultEnd;
  const isShowAll = show_all === 'true';

  const supabase = await createClient();
  const projects = await getProjects();

  // ── Claims sub-tab: vendor cards ──────────────────────────────────────────
  const vendors = subtab !== 'invoices'
    ? await getVendorsWithSummary({
        projectId: project_id,
        kind,
        search,
        startDate: isShowAll ? undefined : startDate,
        endDate: isShowAll ? undefined : endDate,
      })
    : [];

  // ── Invoices sub-tab: approved invoices with remaining balance ────────────
  let invoiceRows: any[] = [];
  if (subtab === 'invoices') {
    let invQ = supabase
      .from('invoices')
      .select('id, invoice_date, status, total, vendor_id, project_id, vendor:vendors(id, name, kind), project:projects(name)')
      .eq('status', 'approved')
      .order('invoice_date', { ascending: false });

    if (project_id) invQ = invQ.eq('project_id', project_id);
    if (kind)       invQ = invQ.eq('vendor:vendors.kind', kind as any);

    const { data: approvedInvoices } = await invQ;

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

      // Apply search filter in-memory
      if (search) {
        const s = search.toLowerCase();
        invoiceRows = invoiceRows.filter((inv: any) =>
          inv.vendor?.name?.toLowerCase().includes(s) ||
          inv.project?.name?.toLowerCase().includes(s)
        );
      }
    }
  }

  // Build current URL params for sub-tab links (preserve filters)
  const baseParams = new URLSearchParams();
  if (project_id) baseParams.set('project_id', project_id);
  if (kind)       baseParams.set('kind', kind);
  if (search)     baseParams.set('search', search);
  if (show_all)   baseParams.set('show_all', show_all);
  if (start_date) baseParams.set('start_date', start_date);
  if (end_date)   baseParams.set('end_date', end_date);

  const claimsUrl   = `/vendors?${new URLSearchParams({ ...Object.fromEntries(baseParams), subtab: 'claims' })}`;
  const invoicesUrl = `/vendors?${new URLSearchParams({ ...Object.fromEntries(baseParams), subtab: 'invoices' })}`;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">المقاولين والموردين</h1>
        {(profile.is_super_admin || profile.can_approve) && (
          <VendorModal projects={projects} />
        )}
      </div>

      <VendorsFilters
        projects={projects || []}
        selectedProjectId={project_id || ''}
        selectedKind={kind || ''}
        searchQuery={search || ''}
        startDate={startDate}
        endDate={endDate}
        showAll={isShowAll}
      />

      {/* ── Sub-tabs ── */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-lg w-fit">
        <Link
          href={claimsUrl}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            subtab !== 'invoices'
              ? 'bg-card shadow text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          📋 مستخلصات المقاولين
        </Link>
        <Link
          href={invoicesUrl}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            subtab === 'invoices'
              ? 'bg-card shadow text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          🧾 فواتير الموردين
        </Link>
      </div>

      {/* ── CLAIMS sub-tab: vendor cards grid ── */}
      {subtab !== 'invoices' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors
            .filter((vendor: any) => vendor.summary.grossTotal > 0)
            .map((vendor: any) => (
            <div key={vendor.id} className="bg-card rounded-lg border shadow-sm flex flex-col justify-between overflow-hidden">
              <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Link href={`/vendors/${vendor.id}/statement`} className="font-bold text-lg hover:text-primary transition-colors">
                    {vendor.name}
                  </Link>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${vendor.kind === 'contractor' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'}`}>
                    {vendor.kind === 'contractor' ? 'مقاول' : 'مورد'}
                  </span>
                </div>
                
                <div className="text-sm text-muted-foreground mb-4">
                  <p>الهاتف: {vendor.phone || 'لا يوجد'}</p>
                  <div className="mt-2">
                    <p className="mb-1">المشاريع:</p>
                    {vendor.all_projects ? (
                      <span className="text-green-600 font-medium">كل المشاريع</span>
                    ) : vendor.vendor_project_access?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {vendor.vendor_project_access.map((acc: any) => (
                          <span key={acc.project_id} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                            {acc.project?.name || 'غير معروف'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">لا توجد مشاريع محددة</span>
                    )}
                  </div>
                </div>
                
                {/* Summary Box */}
                <div className="bg-muted/30 rounded-md p-3 border mt-4 text-sm space-y-1">
                  <h4 className="font-semibold mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    ملخص آخر مستخلص معتمد
                  </h4>

                  {/* Gross */}
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>إجمالي الأعمال التراكمي:</span>
                    <span className="font-medium">{formatMoney(vendor.summary.grossTotal)}</span>
                  </div>

                  {/* Retention */}
                  {vendor.summary.retained > 0 && (
                    <div className="flex justify-between text-xs text-amber-600">
                      <span>المحتجز التراكمي (تأمين):</span>
                      <span className="font-medium">- {formatMoney(vendor.summary.retained)}</span>
                    </div>
                  )}

                  {/* Net cumulative */}
                  <div className="flex justify-between text-xs text-muted-foreground border-t border-muted/40 pt-1">
                    <span>الصافي التراكمي (قابل للدفع):</span>
                    <span className="font-medium">{formatMoney(vendor.summary.netCumulative)}</span>
                  </div>

                  {/* Tax */}
                  {vendor.summary.tax > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>الضريبة:</span>
                      <span>+ {formatMoney(vendor.summary.tax)}</span>
                    </div>
                  )}

                  {/* Paid */}
                  {vendor.summary.totalPaid > 0 && (
                    <div className="flex justify-between text-xs text-green-700 dark:text-green-400 font-medium">
                      <span>المدفوع:</span>
                      <span>- {formatMoney(vendor.summary.totalPaid)}</span>
                    </div>
                  )}

                  {/* Remaining */}
                  <div className="flex justify-between items-center border-t border-primary/20 pt-1.5 mt-0.5">
                    <span className="text-sm font-semibold">
                      {vendor.summary.remaining <= 0 ? '✓ تم السداد بالكامل' : 'المتبقي المستحق:'}
                    </span>
                    <span className={`text-lg font-bold whitespace-nowrap ${
                      vendor.summary.remaining <= 0 ? 'text-green-600' : 'text-primary'
                    }`}>
                      {formatMoney(vendor.summary.remaining)}
                    </span>
                  </div>
                </div>

                {vendor.notes && (
                  <p className="mt-4 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                    ملاحظات: {vendor.notes}
                  </p>
                )}
              </div>
              
              <div className="bg-muted/20 border-t p-3 flex justify-between items-center">
                <Link 
                  href={`/vendors/${vendor.id}/statement`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  كشف الحساب التفصيلي
                </Link>
                {(profile.is_super_admin || profile.can_approve) && (
                  <VendorModal vendor={vendor} projects={projects} />
                )}
              </div>
            </div>
          ))}
          {vendors.filter((v: any) => v.summary.grossTotal > 0).length === 0 && (
            <div className="col-span-full p-8 text-center text-muted-foreground border rounded-lg border-dashed">
              لا توجد مستخلصات معتمدة تطابق خيارات التصفية المحددة.
            </div>
          )}
        </div>
      )}

      {/* ── INVOICES sub-tab: table ── */}
      {subtab === 'invoices' && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-4 font-medium">المورد / المقاول</th>
                <th className="p-4 font-medium">النوع</th>
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
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      inv.vendor?.kind === 'contractor'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-secondary text-secondary-foreground'
                    }`}>
                      {inv.vendor?.kind === 'contractor' ? 'مقاول' : 'مورد'}
                    </span>
                  </td>
                  <td className="p-4 text-muted-foreground">{inv.project?.name || '-'}</td>
                  <td className="p-4 text-muted-foreground">{inv.invoice_date}</td>
                  <td className="p-4 font-medium">{formatMoney(inv.total)}</td>
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
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    لا توجد فواتير معتمدة برصيد متبقي
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
