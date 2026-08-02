'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
        .select('kind, all_projects, vendor_project_access(project_id)')
        .eq('id', parsed.data.party_id)
        .single();
      
      if (!vendorAccess) return { error: 'Vendor not found' };

      // ── Business rule: claims (مستخلصات) are for contractors (مقاول) only ──
      if (vendorAccess.kind !== 'contractor') {
        return { error: 'لا يمكن إنشاء مستخلص لمورد — المستخلصات مخصصة للمقاولين (مصنعيات) فقط' };
      }

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
        .in('claim_id', priorClaims.map(c => c.id))
        .order('created_at', { ascending: true });
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

      const bundle: any[] = item.stock_bundle || [];
      // BundleLine has { item_id, qty_per_unit } — warehouse is on the PARENT item.
      // firstBundle is only used to confirm at least one bundle line has an item_id.
      const firstBundleItem = bundle.find((b: any) => b.item_id && b.qty_per_unit > 0);
      const stockWarehouseId = (item.is_stock_issue && item.warehouse_id) ? item.warehouse_id : null;
      const stockItemId      = (item.is_stock_issue && firstBundleItem?.item_id) ? firstBundleItem.item_id : null;

      // Self-healing: if is_stock_issue=true but warehouse or at least one item isn't configured,
      // fall back to is_stock_issue=false to avoid violating chk_claim_item_stock_issue.
      const isStockIssue = !!(item.is_stock_issue && stockWarehouseId && stockItemId);

      return {
        claim_id: claimData.id,
        item_ref: item.item_ref || crypto.randomUUID(),
        description: item.description,
        unit: item.unit || null,
        previous_qty: server_previous_qty,
        current_qty: Number(item.current_qty),
        unit_price: server_unit_price,
        disbursement_pct: Number(item.disbursement_pct || 1.0),
        line_total: line_total,
        notes: item.notes || null,
        is_stock_issue: isStockIssue,
        warehouse_id: isStockIssue ? stockWarehouseId : null,
        item_id:      isStockIssue ? stockItemId      : null,
        // carry client-side id so we can match bundles after insert
        _client_id:    item.id,
        _warehouse_id: isStockIssue ? stockWarehouseId : null, // parent warehouse for all bundle lines
        _bundle:       isStockIssue ? bundle : [],
      };
    });

    // Strip internal fields before insert
    const dbItemsClean = dbItems.map(({ _client_id: _c, _bundle: _b, _warehouse_id: _w, ...rest }) => rest);

    const { data: insertedItems, error: itemsError } = await supabase
      .from('claim_items')
      .insert(dbItemsClean)
      .select('id, item_ref');
    if (itemsError) {
      await supabase.from('claims').delete().eq('id', claimData.id);
      return { error: itemsError.message };
    }

    // Insert bundle rows — warehouse_id comes from the parent item, NOT the bundle line
    const bundleRows: any[] = [];
    for (const dbItem of dbItems) {
      if (!dbItem.is_stock_issue || !dbItem._bundle || dbItem._bundle.length === 0) continue;
      const inserted = insertedItems?.find((r: any) => r.item_ref === dbItem.item_ref);
      if (!inserted) continue;
      for (const bl of dbItem._bundle) {
        if (!bl.item_id || !bl.qty_per_unit) continue; // no bl.warehouse_id — it's on the parent
        bundleRows.push({
          claim_item_id: inserted.id,
          warehouse_id:  dbItem._warehouse_id, // ← from parent item
          item_id:       bl.item_id,
          qty_per_unit:  Number(bl.qty_per_unit),
        });
      }
    }
    if (bundleRows.length > 0) {
      const { error: bundleError } = await supabase.from('claim_item_stock_bundles').insert(bundleRows);
      if (bundleError) {
        await supabase.from('claims').delete().eq('id', claimData.id);
        return { error: bundleError.message };
      }
    }

    if (attachmentUrls && attachmentUrls.length > 0) {
      const attachRows = attachmentUrls.map(url => ({
        entity_type: 'claim',
        entity_id: claimData.id,
        r2_key: url,
        file_name: url,
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

export async function revertClaimToPending(claimId: string) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('revert_claim_to_pending', { p_claim_id: claimId });
    if (error) return { error: error.message };

    revalidatePath('/claims');
    revalidatePath('/projects', 'layout');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

export async function rejectClaim(claimId: string, reason?: string) {
  try {
    const supabase = await createClient();

    const trimmedReason = reason?.trim();
    if (!trimmedReason) return { error: 'يرجى كتابة سبب الرفض' };

    // Fetch the original submitter for the notification
    const { data: creationAudit } = await supabase
      .from('audit_log')
      .select('employee_id')
      .eq('entity_type', 'claim')
      .eq('entity_id', claimId)
      .eq('action', 'create')
      .maybeSingle();

    // The claim stays in place (still 'pending') tagged with the rejection
    // reason so the submitter can see it and correct the claim in place.
    const { error } = await supabase.rpc('reject_claim', { p_claim_id: claimId, p_reason: trimmedReason });
    if (error) return { error: error.message };

    // Notify the original submitter
    if (creationAudit?.employee_id) {
      await sendPushNotification(
        [creationAudit.employee_id],
        'تم رفض المستخلص',
        `تم رفض المستخلص الذي قدمته — السبب: ${trimmedReason}. يرجى التعديل وإعادة التقديم.`,
        '/claims',
        'claim_rejected'
      );
    }

    revalidatePath('/claims');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

export async function deleteClaim(claimId: string) {
  try {
    const supabase = await createClient();

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id, is_super_admin').eq('auth_user_id', userData.user?.id).single();
    if (!emp) return { error: 'Employee not found' };

    const { data: existing } = await supabase
      .from('claims')
      .select('status, project_id, party_id, claim_type, claim_number')
      .eq('id', claimId)
      .single();
    if (!existing) return { error: 'المستخلص غير موجود' };
    // Only a pending claim can be deleted — nothing has touched stock or the
    // ledger yet (approve_claim is what deducts stock), so this is a clean
    // removal. An approved claim must go through revert-to-pending first.
    if (existing.status !== 'pending') return { error: 'لا يمكن حذف مستخلص معتمد — يجب إرجاعه لقيد المراجعة أولاً' };

    const { data: hasAccess } = await supabase.rpc('has_project_access', { p_project_id: existing.project_id });
    if (!hasAccess && !emp.is_super_admin) return { error: 'لا تملك صلاحية على هذا المشروع' };

    // Safety: never delete anything but the LATEST claim for this vendor/
    // project/type — an older claim may already be relied on by newer claims'
    // previous_qty chain. In practice a pending claim is always the latest
    // (creation blocks a second pending claim for the same group), but we
    // check explicitly rather than assume it.
    const { data: newerClaim } = await supabase
      .from('claims')
      .select('id')
      .eq('party_id', existing.party_id)
      .eq('project_id', existing.project_id)
      .eq('claim_type', existing.claim_type)
      .gt('claim_number', existing.claim_number)
      .limit(1)
      .maybeSingle();
    if (newerClaim) return { error: 'لا يمكن حذف هذا المستخلص لوجود مستخلص أحدث منه لنفس الجهة والمشروع' };

    const adminClient = createAdminClient();
    await adminClient.from('attachments').delete().eq('entity_type', 'claim').eq('entity_id', claimId);

    const { error } = await adminClient.from('claims').delete().eq('id', claimId);
    if (error) return { error: error.message };

    await logAudit({
      employee_id: emp.id,
      action: 'delete',
      entity_type: 'claim',
      entity_id: claimId,
      before: existing,
    });

    revalidatePath('/claims');
    revalidatePath('/projects', 'layout');
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
    // Claim#0 (opening balance) is always editable — lock when Claim#1 exists is at UI level.
    // All other claims must be in 'pending' state to allow edits.
    if (claim.claim_number !== 0 && claim.status !== 'pending') return { error: 'لا يمكن تعديل مستخلص معتمد أو مرفوض' };

    const notes = formData.get('notes') as string | null;
    const claim_date = formData.get('claim_date') as string;
    const tax_enabled = formData.get('tax_enabled') === 'true';
    const tax_rate = parseFloat(formData.get('tax_rate') as string) || 0;
    const _opa = parseFloat(formData.get('opening_paid_amount') as string);
    const opening_paid_amount = isNaN(_opa) ? null : _opa;

    if (!items || items.length === 0) return { error: 'يجب إضافة بند واحد على الأقل' };

    // Fetch prior approved items to recalculate previous_qty server-side.
    // For Claim#0 (opening balance), skip this — previous_qty is always 0
    // and unit_price must come from the user's input directly.
    let priorItems: any[] = [];
    if (claim.claim_number !== 0) {
      const { data: priorClaims } = await supabase
        .from('claims')
        .select('id')
        .eq('party_id', claim.party_id)
        .eq('project_id', claim.project_id)
        .eq('claim_type', claim.claim_type)
        .eq('status', 'approved');

      if (priorClaims && priorClaims.length > 0) {
        const { data: pItems } = await supabase
          .from('claim_items').select('*').in('claim_id', priorClaims.map(c => c.id));
        if (pItems) priorItems = pItems;
      }
    }

    // Update claim header. Clear any previous rejection note — it no longer
    // applies once the claim has been edited.
    const headerUpdate: any = { claim_date, notes, tax_enabled, tax_rate, rejection_reason: null };
    if (claim.claim_number === 0 && opening_paid_amount !== null) {
      headerUpdate.opening_paid_amount = opening_paid_amount;
    }
    const { error: updateError } = await supabase
      .from('claims')
      .update(headerUpdate)
      .eq('id', claimId);
    if (updateError) return { error: updateError.message };

    // Replace items: delete old, insert new
    // Bundle rows are deleted automatically via CASCADE on claim_items
    // NOTE: If the RLS DELETE policy is missing, this silently deletes 0 rows
    // and the subsequent insert produces duplicates. Catch that case explicitly.
    const { error: deleteError } = await supabase
      .from('claim_items')
      .delete()
      .eq('claim_id', claimId);
    if (deleteError) return { error: `فشل حذف البنود القديمة: ${deleteError.message}` };

    const isZeroClaim = claim.claim_number === 0;
    const dbItems = items.map(item => {
      // For Claim#0: always trust the user's input for qty and price
      // For regular claims: recalculate from prior approved items server-side
      let server_previous_qty = 0;
      let server_unit_price = Number(item.unit_price);
      if (!isZeroClaim && item.item_ref) {
        const pastOccurrences = priorItems.filter(pi => pi.item_ref === item.item_ref);
        if (pastOccurrences.length > 0) {
          server_previous_qty = pastOccurrences.reduce((sum: number, pi: any) => sum + Number(pi.current_qty), 0);
          server_unit_price = Number(pastOccurrences[0].unit_price);
        }
      }
      const cumulative_qty = server_previous_qty + Number(item.current_qty);

      const bundle: any[] = item.stock_bundle || [];
      // BundleLine has { item_id, qty_per_unit } — warehouse is on the PARENT item.
      const firstBundleItem = bundle.find((b: any) => b.item_id && b.qty_per_unit > 0);
      const stockWarehouseId = (item.is_stock_issue && item.warehouse_id) ? item.warehouse_id : null;
      const stockItemId      = (item.is_stock_issue && firstBundleItem?.item_id) ? firstBundleItem.item_id : null;

      // Self-healing: avoid constraint violation if bundle isn't fully configured
      const isStockIssue = !!(item.is_stock_issue && stockWarehouseId && stockItemId);

      return {
        claim_id: claimId,
        item_ref: item.item_ref || crypto.randomUUID(),
        description: item.description,
        unit: item.unit || null,
        previous_qty: server_previous_qty,
        current_qty: Number(item.current_qty),
        unit_price: server_unit_price,
        disbursement_pct: Number(item.disbursement_pct || 1.0),
        line_total: cumulative_qty * server_unit_price,
        notes: item.notes || null,
        is_stock_issue: isStockIssue,
        warehouse_id: isStockIssue ? stockWarehouseId : null,
        item_id:      isStockIssue ? stockItemId      : null,
        // internal helpers
        _item_ref:     item.item_ref || null,
        _warehouse_id: isStockIssue ? stockWarehouseId : null,
        _bundle:       isStockIssue ? bundle : [],
      };
    });

    const dbItemsClean = dbItems.map(({ _item_ref: _r, _bundle: _b, _warehouse_id: _w, ...rest }) => rest);

    const { data: insertedItems, error: itemsError } = await supabase
      .from('claim_items')
      .insert(dbItemsClean)
      .select('id, item_ref');
    if (itemsError) return { error: itemsError.message };

    // Insert bundle rows — warehouse_id comes from the parent item, NOT the bundle line
    const bundleRows: any[] = [];
    for (const dbItem of dbItems) {
      if (!dbItem.is_stock_issue || !dbItem._bundle || dbItem._bundle.length === 0) continue;
      const inserted = insertedItems?.find((r: any) => r.item_ref === dbItem.item_ref ||
        (dbItem._item_ref && r.item_ref === dbItem._item_ref));
      if (!inserted) continue;
      for (const bl of dbItem._bundle) {
        if (!bl.item_id || !bl.qty_per_unit) continue; // no bl.warehouse_id — it's on the parent
        bundleRows.push({
          claim_item_id: inserted.id,
          warehouse_id:  dbItem._warehouse_id, // ← from parent item
          item_id:       bl.item_id,
          qty_per_unit:  Number(bl.qty_per_unit),
        });
      }
    }
    if (bundleRows.length > 0) {
      const { error: bundleError } = await supabase.from('claim_item_stock_bundles').insert(bundleRows);
      if (bundleError) return { error: bundleError.message };
    }

    // New attachments
    if (attachmentUrls && attachmentUrls.length > 0) {
      await supabase.from('attachments').insert(
        attachmentUrls.map(url => ({ entity_type: 'claim', entity_id: claimId, r2_key: url, file_name: url, uploaded_by: emp.id }))
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

export async function createZeroClaim(formData: FormData, items: any[], attachmentUrls: string[]) {
  try {
    const supabase = await createClient();

    const claim_type = formData.get('claim_type') as string;
    const party_id = formData.get('party_id') as string;
    const project_id = formData.get('project_id') as string;
    const claim_date = formData.get('claim_date') as string;
    const tax_enabled = formData.get('tax_enabled') === 'true';
    const tax_rate = parseFloat(formData.get('tax_rate') as string) || 0;
    const notes = formData.get('notes') as string;
    const opening_paid_amount = parseFloat(formData.get('opening_paid_amount') as string) || 0;

    if (!items || items.length === 0) return { error: 'At least one item is required' };

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id, is_super_admin').eq('auth_user_id', userData.user?.id).single();
    if (!emp) return { error: 'Employee not found' };

    if (!emp.is_super_admin) return { error: 'لا تملك صلاحية إنشاء رصيد افتتاحي. يجب أن تكون مدير نظام.' };

    // Check if Claim #0 already exists
    const { data: existingZero } = await supabase
      .from('claims')
      .select('id')
      .eq('party_id', party_id)
      .eq('project_id', project_id)
      .eq('claim_type', claim_type)
      .eq('claim_number', 0)
      .maybeSingle();

    if (existingZero) return { error: 'مستخلص #0 موجود بالفعل لهذا الحساب والمشروع.' };

    // Insert Claim Header (Auto-approved)
    const { data: claimData, error: claimError } = await supabase
      .from('claims')
      .insert({
        claim_type,
        party_id,
        project_id,
        claim_date,
        tax_enabled,
        tax_rate,
        notes,
        opening_paid_amount,
        claim_number: 0,
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: emp.id,
      })
      .select('id')
      .single();

    if (claimError) return { error: claimError.message };

    // Prepare Items - ALL previous_qty = 0
    const dbItems = items.map(item => {
      const server_previous_qty = 0;
      const server_unit_price = Number(item.unit_price);
      const cumulative_qty = server_previous_qty + Number(item.current_qty);
      const line_total = cumulative_qty * server_unit_price;

      const bundle: any[] = item.stock_bundle || [];
      const firstBundleItem = bundle.find((b: any) => b.item_id && b.qty_per_unit > 0);
      const stockWarehouseId = (item.is_stock_issue && item.warehouse_id) ? item.warehouse_id : null;
      const stockItemId      = (item.is_stock_issue && firstBundleItem?.item_id) ? firstBundleItem.item_id : null;
      const isStockIssue = !!(item.is_stock_issue && stockWarehouseId && stockItemId);

      return {
        claim_id: claimData.id,
        item_ref: item.item_ref || crypto.randomUUID(),
        description: item.description,
        unit: item.unit || null,
        previous_qty: server_previous_qty,
        current_qty: Number(item.current_qty),
        unit_price: server_unit_price,
        disbursement_pct: Number(item.disbursement_pct || 1.0),
        line_total: line_total,
        notes: item.notes || null,
        is_stock_issue: isStockIssue,
        warehouse_id: isStockIssue ? stockWarehouseId : null,
        item_id:      isStockIssue ? stockItemId      : null,
        _client_id:    item.id,
        _warehouse_id: isStockIssue ? stockWarehouseId : null,
        _bundle:       isStockIssue ? bundle : [],
      };
    });

    const dbItemsClean = dbItems.map(({ _client_id: _c, _bundle: _b, _warehouse_id: _w, ...rest }) => rest);

    const { data: insertedItems, error: itemsError } = await supabase
      .from('claim_items')
      .insert(dbItemsClean)
      .select('id, item_ref');

    if (itemsError) {
      await supabase.from('claims').delete().eq('id', claimData.id);
      return { error: itemsError.message };
    }

    const bundleRows: any[] = [];
    for (const dbItem of dbItems) {
      if (!dbItem.is_stock_issue || !dbItem._bundle || dbItem._bundle.length === 0) continue;
      const inserted = insertedItems?.find((r: any) => r.item_ref === dbItem.item_ref);
      if (!inserted) continue;
      for (const bl of dbItem._bundle) {
        if (!bl.item_id || !bl.qty_per_unit) continue;
        bundleRows.push({
          claim_item_id: inserted.id,
          warehouse_id:  dbItem._warehouse_id,
          item_id:       bl.item_id,
          qty_per_unit:  Number(bl.qty_per_unit),
        });
      }
    }
    if (bundleRows.length > 0) {
      const { error: bundleError } = await supabase.from('claim_item_stock_bundles').insert(bundleRows);
      if (bundleError) {
        await supabase.from('claims').delete().eq('id', claimData.id);
        return { error: bundleError.message };
      }
    }

    if (attachmentUrls && attachmentUrls.length > 0) {
      const attachRows = attachmentUrls.map(url => ({
        entity_type: 'claim',
        entity_id: claimData.id,
        r2_key: url,
        file_name: url,
        uploaded_by: emp.id,
      }));
      await supabase.from('attachments').insert(attachRows);
    }

    await logAudit({
      employee_id: emp.id,
      action: 'create',
      entity_type: 'claim',
      entity_id: claimData.id,
      after: { claim_number: 0, status: 'approved', opening_paid_amount, items: dbItems },
    });

    revalidatePath('/claims');
    revalidatePath('/projects', 'layout');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'An error occurred' };
  }
}
