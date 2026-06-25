import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { CreateClaimForm } from '@/components/claims/create-claim-form';

export const metadata = {
  title: 'تسجيل مستخلص مالك',
};

export default async function CreateOwnerClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();

  // Fetch project details to get owner_id
  const { data: project } = await supabase
    .from('projects')
    .select('*, project_owners(name)')
    .eq('id', projectId)
    .single();

  const { data: warehouses } = await supabase.from('warehouses').select('id, name, project_id');
  const { data: inventoryItems } = await supabase.from('inventory_items').select('id, name, unit, code');

  if (!project) notFound();

  // Redirect if main company (cannot have owner claims)
  if (project.node_type === 'main_company') {
    return (
      <div className="p-8 text-center text-destructive">
        لا يمكن إنشاء مستخلص مالك للشركة الرئيسية.
      </div>
    );
  }

  if (!project.owner_id) {
    return (
      <div className="p-8 text-center text-amber-600">
        يجب تحديد مالك لهذا المشروع أولاً قبل إنشاء مستخلص مالك.
      </div>
    );
  }

  // We need to pass the owner as the 'vendor' to the form, though we hide the select anyway
  const owners = [
    { id: project.owner_id, name: project.project_owners?.name || 'غير محدد' }
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">تسجيل مستخلص مالك</h1>
          <p className="text-muted-foreground mt-1">
            مشروع: {project.name} | المالك: {owners[0].name}
          </p>
        </div>
      </div>
      
      <CreateClaimForm 
        vendors={owners} 
        projects={[project]} 
        claimType="owner"
        fixedProjectId={project.id}
        fixedPartyId={project.owner_id}
        warehouses={warehouses || []}
        inventoryItems={inventoryItems || []}
      />
    </div>
  );
}
