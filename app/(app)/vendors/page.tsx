import { getVendorsWithSummary, getVendorsDirectory } from '@/lib/queries/vendors';
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
  const vendors = subtab !== 'invoices' && subtab !== 'directory'
    ? await getVendorsWithSummary({
        projectId: project_id,
        kind,
        search,
        startDate: isShowAll ? undefined : startDate,
        endDate: isShowAll ? undefined : endDate,
      })
    : [];

  // ── Directory sub-tab: every vendor/supplier, regardless of transactions ──
  const directoryVendors = subtab === 'directory'
    ? await getVendorsDirectory({ projectId: project_id, kind, search })
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

  const claimsUrl    = `/vendors?${new URLSearchParams({ ...Object.fromEntries(baseParams), subtab: 'claims' })}`;
  const invoicesUrl  = `/vendors?${new URLSearchParams({ ...Object.fromEntries(baseParams), subtab: 'invoices' })}`;
  const directoryUrl = `/vendors?${new URLSearchParams({ ...Object.fromEntries(baseParams), subtab: 'directory' })}`;

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
        subtab={subtab}
      />

      {/* ── Sub-tabs ── */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-lg w-fit">
        <Link
          href={claimsUrl}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            subtab !== 'invoices' && subtab !== 'directory'
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
        <Link
          href={directoryUrl}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            subtab === 'directory'
              ? 'bg-card shadow text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          📇 دليل المقاولين والموردين
        </Link>
      </div>

      {/* ── CLAIMS sub-tab: vendor rows ── */}
      {subtab !== 'invoices' && subtab !== 'directory' && (
        <div className="bg-card rounded-lg border shadow-sm overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b whitespace-nowrap">
              <tr>
                <th className="p-4 font-medium">المقاول / المورد</th>
                <th className="p-4 font-medium">المشاريع</th>
                <th className="p-4 font-medium">الإجمالي التراكمي</th>
                <th className="p-4 font-medium">الصافي التراكمي</th>
                <th className="p-4 font-medium text-green-600">المدفوع</th>
                <th className="p-4 font-medium text-primary">المتبقي المستحق</th>
                <th className="p-4 font-medium w-32">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vendors
                .filter((vendor: any) => vendor.summary.grossTotal > 0)
                .map((vendor: any) => (
                  <tr key={vendor.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-4 align-top">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/vendors/${vendor.id}/statement`} className="font-bold text-base hover:text-primary transition-colors">
                            {vendor.name}
                          </Link>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${vendor.kind === 'contractor' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'}`}>
                            {vendor.kind === 'contractor' ? 'مقاول' : 'مورد'}
                          </span>
                        </div>
                        {vendor.phone && <span className="text-xs text-muted-foreground whitespace-nowrap">الهاتف: {vendor.phone}</span>}
                        {vendor.notes && <span className="text-xs text-muted-foreground max-w-[200px] line-clamp-2" title={vendor.notes}>{vendor.notes}</span>}
                      </div>
                    </td>
                    <td className="p-4 align-top">
                      {vendor.all_projects ? (
                        <span className="text-green-600 font-medium text-xs whitespace-nowrap">كل المشاريع</span>
                      ) : vendor.vendor_project_access?.length > 0 ? (
                        <div className="flex flex-wrap gap-1 min-w-[120px] max-w-[250px]">
                          {vendor.vendor_project_access.map((acc: any) => (
                            <span key={acc.project_id} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                              {acc.project?.name || 'غير معروف'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="p-4 align-top whitespace-nowrap">
                      <div className="font-medium">{formatMoney(vendor.summary.grossTotal)}</div>
                      {vendor.summary.retained > 0 && (
                        <div className="text-[11px] text-amber-600 mt-1 font-medium" title="محتجز">
                          - {formatMoney(vendor.summary.retained)} محتجز
                        </div>
                      )}
                    </td>
                    <td className="p-4 align-top whitespace-nowrap">
                      <div className="font-medium">{formatMoney(vendor.summary.netCumulative)}</div>
                      {vendor.summary.tax > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-1" title="ضريبة">
                          + {formatMoney(vendor.summary.tax)} ضريبة
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-green-700 align-top font-medium whitespace-nowrap">
                      {vendor.summary.totalPaid > 0 ? `- ${formatMoney(vendor.summary.totalPaid)}` : '-'}
                    </td>
                    <td className="p-4 align-top whitespace-nowrap">
                      <span className={`font-bold text-base ${vendor.summary.remaining <= 0 ? 'text-green-600' : 'text-primary'}`}>
                        {formatMoney(vendor.summary.remaining)}
                      </span>
                    </td>
                    <td className="p-4 align-top">
                      <div className="flex items-center gap-2">
                        <Link 
                          href={`/vendors/${vendor.id}/statement`}
                          className="text-xs bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded-md font-medium whitespace-nowrap transition-colors"
                        >
                          كشف حساب
                        </Link>
                        {(profile.is_super_admin || profile.can_approve) && (
                          <VendorModal vendor={vendor} projects={projects} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              {vendors.filter((v: any) => v.summary.grossTotal > 0).length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    لا توجد مستخلصات معتمدة تطابق خيارات التصفية المحددة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

      {/* ── DIRECTORY sub-tab: every vendor/supplier, no date filtering ── */}
      {subtab === 'directory' && (
        <div className="bg-card rounded-lg border shadow-sm overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b whitespace-nowrap">
              <tr>
                <th className="p-4 font-medium">الاسم</th>
                <th className="p-4 font-medium">النوع</th>
                <th className="p-4 font-medium">الهاتف</th>
                <th className="p-4 font-medium">المشاريع</th>
                <th className="p-4 font-medium">ملاحظات</th>
                <th className="p-4 font-medium w-40">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {directoryVendors.map((vendor: any) => (
                <tr key={vendor.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-4 align-top font-bold">
                    <Link href={`/vendors/${vendor.id}/statement`} className="hover:text-primary transition-colors">
                      {vendor.name}
                    </Link>
                  </td>
                  <td className="p-4 align-top">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${vendor.kind === 'contractor' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'}`}>
                      {vendor.kind === 'contractor' ? 'مقاول' : 'مورد'}
                    </span>
                  </td>
                  <td className="p-4 align-top text-muted-foreground whitespace-nowrap">{vendor.phone || '-'}</td>
                  <td className="p-4 align-top">
                    {vendor.all_projects ? (
                      <span className="text-green-600 font-medium text-xs whitespace-nowrap">كل المشاريع</span>
                    ) : vendor.vendor_project_access?.length > 0 ? (
                      <div className="flex flex-wrap gap-1 min-w-[120px] max-w-[250px]">
                        {vendor.vendor_project_access.map((acc: any) => (
                          <span key={acc.project_id} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                            {acc.project?.name || 'غير معروف'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="p-4 align-top max-w-[220px] text-xs text-muted-foreground line-clamp-2" title={vendor.notes || ''}>
                    {vendor.notes || '-'}
                  </td>
                  <td className="p-4 align-top">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/vendors/${vendor.id}/statement`}
                        className="text-xs bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded-md font-medium whitespace-nowrap transition-colors"
                      >
                        كشف حساب
                      </Link>
                      {(profile.is_super_admin || profile.can_approve) && (
                        <VendorModal vendor={vendor} projects={projects} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {directoryVendors.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    لا يوجد مقاولين أو موردين مطابقين لخيارات البحث المحددة.
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
