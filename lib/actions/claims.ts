'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { sendPushNotification } from '@/lib/notifications';

const createClaimSchema = z.object({
  claim_type: z.enum(['vendor', 'owner']),
  party_id: z.string().uuid(),
  project_id: z.string().uuid(),
  claim_date: z.string(),
  tax_enabled: z.boolean(),
  tax_rate: z.coerce.number().min(0).max(1),
  notes: z.string().optional(),
});

export async function createClaim(formData: FormData, items: any[], attachmentUrls: string[]) {
  try {
    const supabase = await createClient();
    
    const parsed = createClaimSchema.safeParse({
      claim_type: formData.get('claim_type'),
      party_id: formData.get('party_id'),
      project_id: formData.get('project_id'),
      claim_date: formData.get('claim_date'),
      tax_enabled: formData.get('tax_enabled') === 'true',
      tax_rate: formData.get('tax_rate'),
      notes: formData.get('notes'),
    });

    if (!parsed.success) return { error: 'Invalid claim data' };
    if (!items || items.length === 0) return { error: 'At least one item is required' };

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id, is_super_admin').eq('auth_user_id', userData.user?.id).single();
    if (!emp) return { error: 'Employee not found' };

    const { data: hasAccess } = await supabase.rpc('has_project_access', { p_project_id: parsed.data.project_id });
    if (!hasAccess && !emp.is_super_admin) return { error: 'لا تملك صلاحية على هذا المشروع' };

    if (parsed.data.claim_type === 'vendor') {
      const { data: vendorAccess } = await supabase
        .from('vendors')
        .select('all_projects, vendor_project_access(project_id)')
        .eq('id', parsed.data.party_id)
        .single();
      
      if (!vendorAccess) return { error: 'Vendor not found' };
      if (!vendorAccess.all_projects) {
        const allowedProjects = vendorAccess.vendor_project_access?.map((p: any) => p.project_id) || [];
        if (!allowedProjects.includes(parsed.data.project_id)) {
          return { error: 'هذا المقاول غير مصرح له بالعمل في هذا المشروع' };
        }
      }
    } else if (parsed.data.claim_type === 'owner') {
      const { data: projectData } = await supabase
        .from('projects')
        .select('owner_id')
        .eq('id', parsed.data.project_id)
        .single();
        
      if (!projectData) return { error: 'Project not found' };
      if (!projectData.owner_id) return { error: 'هذا المشروع ليس له مالك محدد بعد' };
      if (projectData.owner_id !== parsed.data.party_id) {
        return { error: 'يجب أن يكون مالك المستخلص هو نفس مالك المشروع' };
      }
    }
    // ── Block if a pending claim already exists for this party+project+type ──
    const { data: pendingExists } = await supabase
      .from('claims')
      .select('id, claim_number')
      .eq('party_id', parsed.data.party_id)
      .eq('project_id', parsed.data.project_id)
      .eq('claim_type', parsed.data.claim_type)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (pendingExists) {
      return {
        error: `لا يمكن إنشاء مستخلص جديد — يوجد مستخلص رقم ${pendingExists.claim_number} قيد المراجعة لنفس المقاول والمشروع. يجب اعتماده أو رفضه أولاً.`,
      };
    }

    // Determine Claim Number
    const { data: lastClaim } = await supabase
      .from('claims')
      .select('claim_number')
      .eq('party_id', parsed.data.party_id)
      .eq('project_id', parsed.data.project_id)
      .eq('claim_type', parsed.data.claim_type)
      .order('claim_number', { ascending: false })
      .limit(1)
      .single();
      
    const nextClaimNumber = lastClaim ? lastClaim.claim_number + 1 : 1;

    // Fetch all prior approved items for this claim to calculate true previous qty securely
    const { data: priorClaims } = await supabase
      .from('claims')
      .select('id')
      .eq('party_id', parsed.data.party_id)
      .eq('project_id', parsed.data.project_id)
      .eq('claim_type', parsed.data.claim_type)
      .eq('status', 'approved');
      
    let priorItems: any[] = [];
    if (priorClaims && priorClaims.length > 0) {
      const { data: pItems } = await supabase
        .from('claim_items')
        .select('*')
        .in('claim_id', priorClaims.map(c => c.id));
      if (pItems) priorItems = pItems;
    }

    // Insert Claim Header
    const { data: claimData, error: claimError } = await supabase
      .from('claims')
      .insert({
        ...parsed.data,
        claim_number: nextClaimNumber,
      })
      .select('id')
      .single();

    if (claimError) return { error: claimError.message };

    // Prepare Items
    const dbItems = items.map(item => {
      let server_previous_qty = 0;
      let server_unit_price = Number(item.unit_price);

      if (item.item_ref) {
        const pastOccurrences = priorItems.filter(pi => pi.item_ref === item.item_ref);
        if (pastOccurrences.length > 0) {
          // Calculate true previous qty (ignoring client's input)
          server_previous_qty = pastOccurrences.reduce((sum, pi) => sum + Number(pi.current_qty), 0);
          // Lock unit price to the original value (ignoring client's input)
          server_unit_price = Number(pastOccurrences[0].unit_price);
        }
      }

      const cumulative_qty = server_previous_qty + Number(item.current_qty);
      const line_total = cumulative_qty * server_unit_price;
      
      return {
        claim_id: claimData.id,
        item_ref: item.item_ref || crypto.randomUUID(),
        description: item.description,
        previous_qty: server_previous_qty,
        current_qty: Number(item.current_qty),
        unit_price: server_unit_price,
        disbursement_pct: Number(item.disbursement_pct || 1.0),
        line_total: line_total,
        is_stock_issue: item.is_stock_issue || false,
        warehouse_id: item.warehouse_id || null,
        item_id: item.item_id || null,
      };
    });

    const { error: itemsError } = await supabase.from('claim_items').insert(dbItems);
    if (itemsError) {
      await supabase.from('claims').delete().eq('id', claimData.id);
      return { error: itemsError.message };
    }

    if (attachmentUrls && attachmentUrls.length > 0) {
      const attachRows = attachmentUrls.map(url => ({
        entity_type: 'claim',
        entity_id: claimData.id,
        r2_key: url,
        uploaded_by: emp.id,
      }));
      await supabase.from('attachments').insert(attachRows);
    }

    await logAudit({
      employee_id: emp.id,
      action: 'create',
      entity_type: 'claim',
      entity_id: claimData.id,
      after: { ...parsed.data, claim_number: nextClaimNumber, items: dbItems },
    });

    // Notify approvers
    const { data: admins } = await supabase.from('employees').select('id').eq('is_super_admin', true);
    if (admins && admins.length > 0) {
      const adminIds = admins.map(a => a.id);
      await sendPushNotification(
        adminIds,
        'مستخلص جديد بانتظار الاعتماد',
        `تم تقديم مستخلص جديد رقم ${nextClaimNumber}`,
        '/claims',
        'claim_submitted'
      );
    }

    revalidatePath('/claims');
    revalidatePath('/projects', 'layout');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'An error occurred' };
  }
}

export async function approveClaim(claimId: string) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('approve_claim', { p_claim_id: claimId });
    if (error) return { error: error.message };
    
    // We could notify the submitter here by checking the audit log to find who created it
    const { data: creationAudit } = await supabase.from('audit_log').select('employee_id').eq('entity_type', 'claim').eq('entity_id', claimId).eq('action', 'create').single();
    if (creationAudit) {
       await sendPushNotification(
         [creationAudit.employee_id],
         'تم اعتماد المستخلص',
         'تم اعتماد المستخلص الخاص بك بنجاح',
         `/claims`,
         'claim_approved'
       );
    }

    revalidatePath('/claims');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

export async function rejectClaim(claimId: string) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('reject_claim', { p_claim_id: claimId });
    if (error) return { error: error.message };
    
    const { data: creationAudit } = await supabase.from('audit_log').select('employee_id').eq('entity_type', 'claim').eq('entity_id', claimId).eq('action', 'create').single();
    if (creationAudit) {
       await sendPushNotification(
         [creationAudit.employee_id],
         'تم رفض المستخلص',
         'تم رفض المستخلص الذي قدمته',
         `/claims`,
         'claim_rejected'
       );
    }

    revalidatePath('/claims');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

export async function updateClaim(claimId: string, formData: FormData, items: any[], attachmentUrls: string[]) {
  try {
    const supabase = await createClient();

    // Auth
    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id, is_super_admin').eq('auth_user_id', userData.user?.id).single();
    if (!emp) return { error: 'Employee not found' };

    // Verify claim exists and is still pending
    const { data: claim } = await supabase
      .from('claims')
      .select('id, status, claim_number, party_id, project_id, claim_type')
      .eq('id', claimId)
      .single();

    if (!claim) return { error: 'المستخلص غير موجود' };
    if (claim.status !== 'pending') return { error: 'لا يمكن تعديل مستخلص معتمد أو مرفوض' };

    const notes = formData.get('notes') as string | null;
    const claim_date = formData.get('claim_date') as string;
    const tax_enabled = formData.get('tax_enabled') === 'true';
    const tax_rate = parseFloat(formData.get('tax_rate') as string) || 0;

    if (!items || items.length === 0) return { error: 'يجب إضافة بند واحد على الأقل' };

    // Fetch prior approved items to recalculate previous_qty server-side
    const { data: priorClaims } = await supabase
      .from('claims')
      .select('id')
      .eq('party_id', claim.party_id)
      .eq('project_id', claim.project_id)
      .eq('claim_type', claim.claim_type)
      .eq('status', 'approved');

    let priorItems: any[] = [];
    if (priorClaims && priorClaims.length > 0) {
      const { data: pItems } = await supabase
        .from('claim_items').select('*').in('claim_id', priorClaims.map(c => c.id));
      if (pItems) priorItems = pItems;
    }

    // Update claim header
    const { error: updateError } = await supabase
      .from('claims')
      .update({ claim_date, notes, tax_enabled, tax_rate })
      .eq('id', claimId);
    if (updateError) return { error: updateError.message };

    // Replace items: delete old, insert new
    await supabase.from('claim_items').delete().eq('claim_id', claimId);

    const dbItems = items.map(item => {
      let server_previous_qty = 0;
      let server_unit_price = Number(item.unit_price);
      if (item.item_ref) {
        const pastOccurrences = priorItems.filter(pi => pi.item_ref === item.item_ref);
        if (pastOccurrences.length > 0) {
          server_previous_qty = pastOccurrences.reduce((sum: number, pi: any) => sum + Number(pi.current_qty), 0);
          server_unit_price = Number(pastOccurrences[0].unit_price);
        }
      }
      const cumulative_qty = server_previous_qty + Number(item.current_qty);
      return {
        claim_id: claimId,
        item_ref: item.item_ref || crypto.randomUUID(),
        description: item.description,
        previous_qty: server_previous_qty,
        current_qty: Number(item.current_qty),
        unit_price: server_unit_price,
        disbursement_pct: Number(item.disbursement_pct || 1.0),
        line_total: cumulative_qty * server_unit_price,
        is_stock_issue: item.is_stock_issue || false,
        warehouse_id: item.warehouse_id || null,
        item_id: item.item_id || null,
      };
    });

    const { error: itemsError } = await supabase.from('claim_items').insert(dbItems);
    if (itemsError) return { error: itemsError.message };

    // New attachments
    if (attachmentUrls && attachmentUrls.length > 0) {
      await supabase.from('attachments').insert(
        attachmentUrls.map(url => ({ entity_type: 'claim', entity_id: claimId, r2_key: url, uploaded_by: emp.id }))
      );
    }

    await logAudit({ employee_id: emp.id, action: 'update', entity_type: 'claim', entity_id: claimId, after: { claim_date, notes, items: dbItems } });

    revalidatePath('/claims');
    revalidatePath(`/claims/${claimId}/edit`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}
