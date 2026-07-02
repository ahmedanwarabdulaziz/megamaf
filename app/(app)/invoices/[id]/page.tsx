import { getInvoice } from '@/lib/queries/invoices';
import { getProfile } from '@/lib/supabase/get-profile';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { ArrowRight, Receipt, Phone, Building2, Calendar, CreditCard, Clock, FileText } from 'lucide-react';
import { InvoiceApproveRejectButtons } from '@/components/invoices/approve-reject-buttons';
import { getBatchSignedUrls } from '@/lib/r2';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { Button } from '@/components/ui/button';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: 'تفاصيل الفاتورة' };
}

export default async function InvoiceDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await getProfile();
  if (!profile) return null;

  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const r2Keys = invoice.attachments.map((a: any) => a.r2_key);
  const signedUrls = await getBatchSignedUrls(r2Keys);

  const isPending = invoice.status === 'pending';
  const isApproved = invoice.status === 'approved';
  const isRejected = invoice.status === 'rejected';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/invoices" className="p-2 bg-muted rounded-full hover:bg-muted/80 transition-colors">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="w-6 h-6 text-primary" />
              تفاصيل فاتورة رقم {invoice.invoice_number}
            </h1>
            <p className="text-muted-foreground text-sm mt-1 font-mono">{invoice.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isPending && (profile.can_approve || profile.is_super_admin) && (
            <InvoiceApproveRejectButtons invoiceId={invoice.id} />
          )}
          {isApproved && invoice.balance > 0 && (
            <Link href={`/treasury/pay/${invoice.vendor_id}`}>
              <Button>تسديد دفعة</Button>
            </Link>
          )}
          <span className={`px-4 py-1.5 rounded-full text-sm font-semibold border ${isApproved ? 'bg-primary/10 text-primary border-primary/20' : isRejected ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'}`}>
            {isApproved ? 'معتمدة' : isRejected ? 'مرفوضة' : 'قيد المراجعة'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Info Cards */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-card rounded-lg border shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  <Building2 className="w-4 h-4" /> المورد / المقاول
                </h3>
                <Link href={`/vendors/${invoice.vendor_id}/statement`} className="text-lg font-bold text-primary hover:underline">
                  {invoice.vendor?.name}
                </Link>
                {invoice.vendor?.phone && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                    <Phone className="w-3.5 h-3.5" /> {invoice.vendor.phone}
                  </p>
                )}
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> المشروع
                </h3>
                <p className="font-medium">{invoice.project?.name || 'غير محدد'}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> تاريخ الفاتورة
                </h3>
                <p className="font-medium">{invoice.invoice_date}</p>
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> تاريخ التسجيل
                </h3>
                <p className="font-medium" dir="ltr">{new Date(invoice.created_at).toLocaleString('en-GB')}</p>
              </div>
            </div>
          </div>

          {/* Invoice Items */}
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/20">
              <h2 className="font-bold">بنود الفاتورة</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left rtl:text-right">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">الوصف</th>
                    <th className="px-4 py-3 font-medium text-center">الكمية</th>
                    <th className="px-4 py-3 font-medium">سعر الوحدة</th>
                    <th className="px-4 py-3 font-medium">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoice.items?.map((item: any) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium">{item.description}</td>
                      <td className="px-4 py-3 text-center">{item.qty}</td>
                      <td className="px-4 py-3">{formatMoney(item.unit_price)}</td>
                      <td className="px-4 py-3 font-bold">{formatMoney(item.line_total)}</td>
                    </tr>
                  ))}
                  {(!invoice.items || invoice.items.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        لا توجد بنود مسجلة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {invoice.notes && (
            <div className="bg-muted/30 p-4 rounded-lg border border-dashed">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">ملاحظات</h3>
              <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>

        {/* Summary and Attachments */}
        <div className="space-y-6">
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2">
                <CreditCard className="w-4 h-4" /> ملخص الفاتورة
              </h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between items-center text-muted-foreground">
                <span>المجموع الفرعي:</span>
                <span className="font-medium text-foreground">{formatMoney(invoice.subtotal)}</span>
              </div>
              
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between items-center text-green-600">
                  <span>الخصم ({invoice.discount_rate}%):</span>
                  <span className="font-medium">-{formatMoney(invoice.discount_amount)}</span>
                </div>
              )}
              
              {invoice.tax_enabled && (
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>الضريبة ({invoice.tax_rate * 100}%):</span>
                  <span className="font-medium text-foreground">{formatMoney(invoice.tax_amount)}</span>
                </div>
              )}
              
              <div className="pt-3 border-t flex justify-between items-center">
                <span className="font-bold text-base">الإجمالي:</span>
                <span className="font-bold text-lg text-primary">{formatMoney(invoice.total)}</span>
              </div>
              
              {isApproved && (
                <div className="pt-3 border-t border-dashed space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">المدفوع:</span>
                    <span className="font-medium text-green-600">{formatMoney(invoice.paid_amount || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold">المتبقي:</span>
                    <span className={`font-bold ${invoice.balance > 0 ? 'text-red-500' : 'text-primary'}`}>
                      {formatMoney(invoice.balance || 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/20">
              <h2 className="font-bold flex items-center gap-2">
                <FileText className="w-4 h-4" /> المرفقات ({invoice.attachments?.length || 0})
              </h2>
            </div>
            <div className="p-4">
              {invoice.attachments?.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {invoice.attachments.map((att: any, i: number) => {
                    const url = signedUrls[att.r2_key];
                    return (
                      <div key={i} className="relative aspect-square rounded-md overflow-hidden border group bg-muted/30">
                        {url ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="مرفق" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ImageLightbox src={url} alt={`مرفق ${i+1}`} />
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-xs p-2 text-center">
                            <FileText className="w-6 h-6 mb-1 opacity-50" />
                            مرفق غير متاح
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground py-4">لا توجد مرفقات</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
