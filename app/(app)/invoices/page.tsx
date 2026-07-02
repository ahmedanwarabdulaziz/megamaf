import Link from 'next/link';
import { getInvoicesWithFilters, getActionRequiredInvoices } from '@/lib/queries/invoices';
import { getProjects } from '@/lib/queries/projects';
import { getVendors } from '@/lib/queries/vendors';
import { getProfile } from '@/lib/supabase/get-profile';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { InvoiceApproveRejectButtons } from '@/components/invoices/approve-reject-buttons';
import { InvoicesFilters } from '@/components/invoices/invoices-filters';
import { requirePageAccess } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'فواتير الموردين',
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string, vendor_id?: string, search?: string, start_date?: string, end_date?: string, status?: string }>;
}) {
  const { project_id, vendor_id, search, start_date, end_date, status } = await searchParams;
  await requirePageAccess('vendors'); // invoices are under vendors access
  const { profile } = await getProfile();
  if (!profile) return null;

  const [invoices, actionRequiredInvoices, projects, vendors] = await Promise.all([
    getInvoicesWithFilters({
      projectId: project_id,
      vendorId: vendor_id,
      search,
      startDate: start_date,
      endDate: end_date,
      status
    }),
    getActionRequiredInvoices(),
    getProjects(),
    getVendors()
  ]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">فواتير الموردين</h1>
        <Link href="/invoices/create">
          <Button>تسجيل فاتورة جديدة</Button>
        </Link>
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
      />

      {/* Action Required Section */}
      {actionRequiredInvoices.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4 text-destructive flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse"></span>
            فواتير تتطلب إجراء (قيد المراجعة أو غير مسددة بالكامل)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {actionRequiredInvoices.map((invoice: any) => (
              <InvoiceCard key={`action-${invoice.id}`} invoice={invoice} profile={profile} isActionRequired={true} />
            ))}
          </div>
        </div>
      )}

      {/* Normal Invoices Section */}
      <div>
        <h2 className="text-xl font-bold mb-4">قائمة الفواتير</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {invoices.map((invoice: any) => (
            <InvoiceCard key={`normal-${invoice.id}`} invoice={invoice} profile={profile} />
          ))}
          {invoices.length === 0 && (
            <div className="col-span-full p-8 text-center text-muted-foreground border rounded-lg border-dashed">
              لا توجد فواتير تطابق خيارات البحث
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InvoiceCard({ invoice, profile, isActionRequired = false }: { invoice: any, profile: any, isActionRequired?: boolean }) {
  return (
    <div className={`bg-card rounded-lg border shadow-sm flex flex-col justify-between overflow-hidden ${isActionRequired ? 'border-destructive/30 shadow-destructive/10' : ''}`}>
      <div className="p-4">
        <div className="flex justify-between items-start mb-2">
          <Link href={`/invoices/${invoice.id}`} className="font-bold text-lg hover:text-primary transition-colors">
            {invoice.vendor?.name || 'مورد غير معروف'} - فاتورة رقم {invoice.invoice_number}
          </Link>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${invoice.status === 'approved' ? 'bg-primary/10 text-primary' : invoice.status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-secondary-foreground'}`}>
            {invoice.status === 'approved' ? 'معتمد' : invoice.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
          </span>
        </div>
        
        <div className="text-sm text-muted-foreground mb-4">
          <p>المشروع: {invoice.project?.name || 'غير محدد'}</p>
          <p>التاريخ: {invoice.invoice_date}</p>
          {invoice.vendor?.phone && <p>الهاتف: {invoice.vendor.phone}</p>}
          {invoice.attachments && invoice.attachments.length > 0 && (
            <p className="mt-1 text-primary font-medium text-xs flex items-center gap-1">
              مرفقات ({invoice.attachments.length})
            </p>
          )}
        </div>
        
        {/* Summary Box */}
        <div className="bg-muted/30 rounded-md p-3 border mt-4 text-sm">
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>إجمالي الفاتورة:</span>
              <span className="font-medium">{formatMoney(invoice.total)}</span>
            </div>
            {invoice.status === 'approved' && (
              <>
                <div className="flex justify-between">
                  <span>المدفوع:</span>
                  <span className="font-medium text-green-600">{formatMoney(invoice.paid_amount || 0)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1 font-bold">
                  <span>الرصيد المتبقي:</span>
                  <span className={(invoice.balance || 0) > 0 ? 'text-red-500' : 'text-primary'}>
                    {formatMoney(invoice.balance || 0)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      <div className="bg-muted/20 border-t p-3 flex justify-between items-center min-h-[56px]">
        <Link 
          href={`/invoices/${invoice.id}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          عرض التفاصيل
        </Link>
        {invoice.status === 'pending' && (profile.can_approve || profile.is_super_admin) && (
          <InvoiceApproveRejectButtons invoiceId={invoice.id} />
        )}
      </div>
    </div>
  );
}
