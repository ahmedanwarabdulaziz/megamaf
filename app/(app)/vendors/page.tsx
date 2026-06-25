import { getVendors } from '@/lib/queries/vendors';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { VendorModal } from '@/components/vendors/vendor-modal';

export const metadata = {
  title: 'المقاولين والموردين',
};

export default async function VendorsPage() {
  const { profile } = await getProfile();
  if (!profile) return null;

  const vendors = await getVendors();
  const projects = await getProjects();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">المقاولين والموردين</h1>
        {(profile.is_super_admin || profile.can_approve) && (
          <VendorModal projects={projects} />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendors.map(vendor => (
          <div key={vendor.id} className="bg-card rounded-lg border p-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg">{vendor.name}</h3>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${vendor.kind === 'contractor' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                  {vendor.kind === 'contractor' ? 'مقاول' : 'مورد'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                {vendor.phone || 'لا يوجد هاتف'}
              </p>
              
              <div className="text-sm">
                <span className="font-medium">المشاريع:</span>{' '}
                {vendor.all_projects ? (
                  <span className="text-green-600">كل المشاريع</span>
                ) : (
                  <span className="text-muted-foreground">
                    {vendor.vendor_project_access?.length} مشروع محدد
                  </span>
                )}
              </div>
              {vendor.notes && (
                <p className="mt-2 text-sm text-muted-foreground bg-muted/50 p-2 rounded">
                  {vendor.notes}
                </p>
              )}
            </div>
            
            {(profile.is_super_admin || profile.can_approve) && (
              <div className="mt-4 flex justify-end">
                <VendorModal vendor={vendor} projects={projects} />
              </div>
            )}
          </div>
        ))}
        {vendors.length === 0 && (
          <div className="col-span-full p-8 text-center text-muted-foreground border rounded-lg border-dashed">
            لا يوجد مقاولين أو موردين
          </div>
        )}
      </div>
    </div>
  );
}
