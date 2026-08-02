import Link from 'next/link';
import { getInvoicesWithFilters, getActionRequiredInvoices } from '@/lib/queries/invoices';
import { getProjects } from '@/lib/queries/projects';
import { getVendors } from '@/lib/queries/vendors';
import { getProfile } from '@/lib/supabase/get-profile';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { InvoiceApproveRejectButtons } from '@/components/invoices/approve-reject-buttons';
import { InvoicesFilters } from '@/components/invoices/invoices-filters';
import { DeleteInvoiceButton } from '@/components/invoices/delete-invoice-button';
import { requirePageAccess } from '@/lib/require-page-access';
import { Pencil, AlertTriangle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'فواتير الموردين',
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string, project_id?: string, vendor_id?: string, search?: string, start_date?: string, end_date?: string, status?: string }>;
}) {
  const { tab = 'action_required', project_id, vendor_id, search, start_date, end_date, status } = await searchParams;
  await requirePageAccess('vendors'); // invoices are under vendors access
  const { profile } = await getProfile();
  if (!profile) return null;

  const isActionRequired = tab !== 'all';

  const [invoices, actionRequiredCount, projects, vendors] = await Promise.all([
    isActionRequired
      ? getActionRequiredInvoices({
          projectId: project_id,
          vendorId: vendor_id,
          search,
          startDate: start_date,
          endDate: end_date,
        })
      : getInvoicesWithFilters({
          projectId: project_id,
          vendorId: vendor_id,
          search,
          startDate: start_date,
          endDate: end_date,
          status,
        }),
    getActionRequiredInvoices(),
    getProjects(),
    getVendors(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">فواتير الموردين</h1>
        <Link href="/invoices/create">
          <Button>تسجيل فاتورة جديدة</Button>
        </Link>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto pb-1">
        <a
          href="?tab=action_required"
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-2 ${
            isActionRequired
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          فواتير تتطلب إجراء
          {actionRequiredCount.length > 0 && (
            <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full font-semibold">
              {actionRequiredCount.length}
            </span>
          )}
        </a>
        <a
          href="?tab=all"
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            !isActionRequired
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          قائمة الفواتير
        </a>
      </div>

      <InvoicesFilters
        projects={projects || []}
        vendors={vendors || []}
        selectedProjectId={project_id || ''}
        selectedVendorId={vendor_id || ''}
        selectedStatus={status || ''}
        searchQuery={search || ''}
        startDate={start_date || ''}
        endDate={end_date || ''}
        basePath="/invoices"
        activeTab={tab}
        showStatusFilter={!isActionRequired}
      />

      <InvoicesTable invoices={invoices} profile={profile} isActionRequired={isActionRequired} />
    </div>
  );
}

function InvoicesTable({ invoices, profile, isActionRequired = false }: { invoices: any[], profile: any, isActionRequired?: boolean }) {
  return (
    <div className={`bg-card rounded-lg border shadow-sm overflow-x-auto ${isActionRequired ? 'border-destructive/30 shadow-destructive/10' : ''}`}>
      <table className="w-full text-sm text-right">
        <thead className="bg-muted/50 border-b whitespace-nowrap">
          <tr>
            <th className="p-4 font-medium">المورد</th>
            <th className="p-4 font-medium">رقم الفاتورة</th>
            <th className="p-4 font-medium">المشروع</th>
            <th className="p-4 font-medium">التاريخ</th>
            <th className="p-4 font-medium">الحالة</th>
            <th className="p-4 font-medium">إجمالي الفاتورة</th>
            <th className="p-4 font-medium text-green-600">المدفوع</th>
            <th className="p-4 font-medium text-primary">المتبقي</th>
            <th className="p-4 font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invoices.map((invoice: any) => (
            <tr key={invoice.id} className="hover:bg-muted/30 transition-colors">
              <td className="p-4 align-top">
                <div className="flex flex-col gap-0.5">
                  <Link href={`/invoices/${invoice.id}`} className="font-semibold hover:text-primary transition-colors">
                    {invoice.vendor?.name || 'مورد غير معروف'}
                  </Link>
                  {invoice.vendor?.phone && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{invoice.vendor.phone}</span>
                  )}
                  {invoice.attachments && invoice.attachments.length > 0 && (
                    <span className="text-xs text-primary font-medium">مرفقات ({invoice.attachments.length})</span>
                  )}
                </div>
              </td>
              <td className="p-4 align-top whitespace-nowrap">
                <Link href={`/invoices/${invoice.id}`} className="hover:text-primary transition-colors">
                  {invoice.invoice_number}
                </Link>
              </td>
              <td className="p-4 align-top text-muted-foreground">{invoice.project?.name || 'غير محدد'}</td>
              <td className="p-4 align-top text-muted-foreground whitespace-nowrap">{invoice.invoice_date}</td>
              <td className="p-4 align-top whitespace-nowrap">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${invoice.status === 'approved' ? 'bg-primary/10 text-primary' : invoice.status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-secondary-foreground'}`}>
                  {invoice.status === 'approved' ? 'معتمد' : invoice.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                </span>
                {invoice.status === 'rejected' && invoice.rejection_reason && (
                  <div className="flex items-start gap-1 mt-1.5 text-xs text-destructive max-w-[200px]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{invoice.rejection_reason}</span>
                  </div>
                )}
              </td>
              <td className="p-4 align-top font-medium whitespace-nowrap">{formatMoney(invoice.total)}</td>
              <td className="p-4 align-top text-green-700 whitespace-nowrap">
                {invoice.status === 'approved' ? formatMoney(invoice.paid_amount || 0) : '-'}
              </td>
              <td className="p-4 align-top whitespace-nowrap">
                {invoice.status === 'approved' ? (
                  <span className={`font-bold ${(invoice.balance || 0) > 0 ? 'text-red-500' : 'text-primary'}`}>
                    {formatMoney(invoice.balance || 0)}
                  </span>
                ) : '-'}
              </td>
              <td className="p-4 align-top">
                <div className="flex items-center gap-1">
                  <Link
                    href={`/invoices/${invoice.id}`}
                    className="text-xs bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded-md font-medium whitespace-nowrap transition-colors"
                  >
                    التفاصيل
                  </Link>
                  {invoice.status !== 'approved' && (
                    <>
                      <Link
                        href={`/invoices/${invoice.id}/edit`}
                        title="تعديل"
                        className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                      >
                        <Pencil className="w-4 h-4 text-blue-500" />
                      </Link>
                      <DeleteInvoiceButton invoiceId={invoice.id} />
                    </>
                  )}
                  {invoice.status === 'pending' && (profile.can_approve || profile.is_super_admin) && (
                    <InvoiceApproveRejectButtons invoiceId={invoice.id} />
                  )}
                </div>
              </td>
            </tr>
          ))}
          {invoices.length === 0 && (
            <tr>
              <td colSpan={9} className="p-8 text-center text-muted-foreground">
                لا توجد فواتير تطابق خيارات البحث
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
