'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';

const saveVendorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2),
  kind: z.enum(['vendor', 'contractor']),
  phone: z.string().optional(),
  notes: z.string().optional(),
  all_projects: z.coerce.boolean(),
});

export async function saveVendor(formData: FormData, projectIds: string[]) {
  try {
    const supabase = await createClient();
    
    const parsed = saveVendorSchema.safeParse({
      id: formData.get('id') || undefined,
      name: formData.get('name'),
      kind: formData.get('kind'),
      phone: formData.get('phone'),
      notes: formData.get('notes'),
      all_projects: formData.get('all_projects') === 'true',
    });

    if (!parsed.success) return { error: 'Invalid vendor data' };
    const { id, ...vendorData } = parsed.data;

    let vendorId = id;

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
    if (!emp) return { error: 'Employee not found' };

    if (vendorId) {
      const { error } = await supabase
        .from('vendors')
        .update(vendorData)
        .eq('id', vendorId);
      if (error) return { error: error.message };
      
      await logAudit({
        employee_id: emp.id,
        action: 'update',
        entity_type: 'vendor',
        entity_id: vendorId,
        after: vendorData,
      });
    } else {
      const { data, error } = await supabase
        .from('vendors')
        .insert(vendorData)
        .select('id')
        .single();
      if (error) return { error: error.message };
      vendorId = data.id;

      await logAudit({
        employee_id: emp.id,
        action: 'create',
        entity_type: 'vendor',
        entity_id: vendorId,
        after: vendorData,
      });
    }

    // Handle project access
    if (vendorData.all_projects) {
      await supabase.from('vendor_project_access').delete().eq('vendor_id', vendorId);
    } else {
      await supabase.from('vendor_project_access').delete().eq('vendor_id', vendorId);
      if (projectIds.length > 0) {
        const rows = projectIds.map(pid => ({ vendor_id: vendorId, project_id: pid }));
        await supabase.from('vendor_project_access').insert(rows);
      }
    }

    revalidatePath('/vendors');
    return { success: true, vendorId };
  } catch (e: any) {
    return { error: e.message || 'An error occurred' };
  }
}
