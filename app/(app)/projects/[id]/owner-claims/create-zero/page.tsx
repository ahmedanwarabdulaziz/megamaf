import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/get-profile';
import { CreateZeroClaimForm } from '@/components/claims/create-zero-claim-form';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function CreateZeroOwnerClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params;

  if (!project_id) {
    redirect('/projects');
  }

  const { profile, supabase } = await getProfile();

  if (!profile?.is_super_admin) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
        <div className="text-4xl">🔒</div>
        <h2 className="text-2xl font-bold text-destructive">صلاحيات غير كافية</h2>
        <p className="text-muted-foreground">فقط مدير النظام يمكنه إنشاء رصيد افتتاحي (مستخلص #0).</p>
        <Link href={`/projects/${project_id}?tab=claims`}><Button>العودة للمشروع</Button></Link>
      </div>
    );
  }

  // Fetch basic data
  const [
    { data: project },
    { data: warehouses },
    { data: inventoryItems },
    { data: stockLevels },
  ] = await Promise.all([
    supabase.from('projects').select('id, name, owner_id, project_owners:project_owners!projects_owner_id_fkey(name)').eq('id', project_id).single(),
    supabase.from('warehouses').select('id, name').order('name'),
    supabase.from('inventory_items').select('id, code, name, unit').order('name'),
    supabase.from('v_stock_levels').select('warehouse_id, item_id, qty_on_hand, item_unit'),
  ]);

  if (!project) {
    redirect('/projects');
  }

  if (!project.owner_id) {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="bg-destructive/10 text-destructive border border-destructive/20 p-6 rounded-xl flex flex-col items-center justify-center text-center space-y-3">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-xl font-bold">المشروع بدون مالك</h2>
          <p>يجب تعيين مالك للمشروع أولاً قبل إنشاء مستخلص مالك.</p>
          <Link href={`/projects/${project_id}`}><Button variant="outline" className="mt-2 text-destructive border-destructive hover:bg-destructive/10">العودة للمشروع</Button></Link>
        </div>
      </div>
    );
  }

  const ownerName = (Array.isArray(project.project_owners) ? project.project_owners[0]?.name : (project.project_owners as any)?.name) || 'المالك';

  // Check if Claim #0 already exists for this owner and project
  const { data: existingClaim0 } = await supabase
    .from('claims')
    .select('id')
    .eq('party_id', project.owner_id)
    .eq('project_id', project_id)
    .eq('claim_type', 'owner')
    .eq('claim_number', 0)
    .maybeSingle();

  if (existingClaim0) {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="bg-destructive/10 text-destructive border border-destructive/20 p-6 rounded-xl flex flex-col items-center justify-center text-center space-y-3">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-xl font-bold">مستخلص #0 موجود بالفعل</h2>
          <p>تم إدخال الرصيد الافتتاحي مسبقاً لمالك هذا المشروع.</p>
          <Link href={`/projects/${project_id}?tab=claims`}><Button variant="outline" className="mt-2 text-destructive border-destructive hover:bg-destructive/10">العودة للمستخلصات</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/projects/${project_id}?tab=claims`} className="text-muted-foreground hover:text-foreground transition-colors p-2 -m-2 rounded-full hover:bg-muted">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">مستخلص مالك #0 — رصيد افتتاحي</h1>
          <p className="text-muted-foreground">رصيد ما قبل النظام لمالك المشروع</p>
        </div>
      </div>

      <CreateZeroClaimForm
        vendors={[]}
        projects={[]}
        claimType="owner"
        fixedPartyId={project.owner_id}
        fixedPartyName={ownerName}
        fixedProjectId={project_id}
        fixedProjectName={project.name}
        warehouses={warehouses || []}
        inventoryItems={inventoryItems || []}
        stockLevels={stockLevels || []}
      />
    </div>
  );
}
