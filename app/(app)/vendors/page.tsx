import { getVendorsWithSummary } from '@/lib/queries/vendors';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { VendorModal } from '@/components/vendors/vendor-modal';
import { VendorsFilters } from '@/components/vendors/vendors-filters';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';

export const metadata = {
  title: 'المقاولين والموردين',
};

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string, kind?: string, search?: string, start_date?: string, end_date?: string, show_all?: string }>;
}) {
  const { project_id, kind, search, start_date, end_date, show_all } = await searchParams;
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

  const projects = await getProjects();
  const vendors = await getVendorsWithSummary({
    projectId: project_id,
    kind,
    search,
    startDate: isShowAll ? undefined : startDate,
    endDate: isShowAll ? undefined : endDate,
  });

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendors.map((vendor: any) => (
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
                <p className="mt-1">
                  المشاريع:{' '}
                  {vendor.all_projects ? (
                    <span className="text-green-600">كل المشاريع</span>
                  ) : (
                    <span>{vendor.vendor_project_access?.length || 0} مشروع محدد</span>
                  )}
                </p>
              </div>
              
              {/* Summary Box */}
              <div className="bg-muted/30 rounded-md p-3 border mt-4 text-sm">
                <h4 className="font-semibold mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {isShowAll ? 'الرصيد الإجمالي' : 'ملخص الفترة المحددة'}
                </h4>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>إجمالي المستحقات:</span>
                    <span className="font-medium">{formatMoney(vendor.summary.total_due)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>المدفوعات:</span>
                    <span className="font-medium text-green-600">{formatMoney(vendor.summary.total_paid)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 mt-1 font-bold">
                    <span>الرصيد المتبقي:</span>
                    <span className={vendor.summary.balance > 0 ? 'text-red-500' : 'text-primary'}>
                      {formatMoney(vendor.summary.balance)}
                    </span>
                  </div>
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
        {vendors.length === 0 && (
          <div className="col-span-full p-8 text-center text-muted-foreground border rounded-lg border-dashed">
            لا توجد نتائج تطابق خيارات التصفية المحددة.
          </div>
        )}
      </div>
    </div>
  );
}
