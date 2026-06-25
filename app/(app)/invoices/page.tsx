import Link from 'next/link';
import { getInvoices } from '@/lib/queries/invoices';
import { getProfile } from '@/lib/supabase/get-profile';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { InvoiceApproveRejectButtons } from '@/components/invoices/approve-reject-buttons';

export const metadata = {
  title: 'فواتير الموردين',
};

export default async function InvoicesPage() {
  const { profile } = await getProfile();
  if (!profile) return null;

  const invoices = await getInvoices();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">فواتير الموردين</h1>
        <Link href="/invoices/create">
          <Button>تسجيل فاتورة جديدة</Button>
        </Link>
      </div>

      <div className="bg-card rounded-lg border shadow-sm divide-y">
        {invoices.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد فواتير</div>
        ) : (
          invoices.map((invoice: any) => (

            <div key={invoice.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold">{invoice.vendor?.name}</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${invoice.status === 'approved' ? 'bg-primary text-primary-foreground' : invoice.status === 'rejected' ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                    {invoice.status === 'approved' ? 'معتمد' : invoice.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                  </span>
                </div>
                <p className="text-sm">{invoice.project?.name}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>التاريخ: {invoice.invoice_date}</span>
                  {invoice.attachments && invoice.attachments.length > 0 && (
                    <span className="text-primary font-medium">مرفق ({invoice.attachments.length})</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="text-xl font-bold whitespace-nowrap">
                  {formatMoney(invoice.total)}
                </div>
                {invoice.status === 'pending' && (profile.can_approve || profile.is_super_admin) && (
                  <InvoiceApproveRejectButtons invoiceId={invoice.id} />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
