'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { sendPushNotification } from '@/lib/notifications';

const createInvoiceSchema = z.object({
  vendor_id: z.string().uuid(),
  project_id: z.string().uuid(),
  invoice_date: z.string(),
  tax_enabled: z.boolean(),
  tax_rate: z.coerce.number().min(0).max(1),
  discount_rate: z.coerce.number().min(0).max(1),
  notes: z.string().optional(),
});

export async function createInvoice(formData: FormData, items: any[], attachmentUrls: string[]) {
  try {
    const supabase = await createClient();
    
    const parsed = createInvoiceSchema.safeParse({
      vendor_id: formData.get('vendor_id'),
      project_id: formData.get('project_id'),
      invoice_date: formData.get('invoice_date'),
      tax_enabled: formData.get('tax_enabled') === 'true',
      tax_rate: formData.get('tax_rate'),
      discount_rate: formData.get('discount_rate'),
      notes: formData.get('notes'),
    });

    if (!parsed.success) return { error: 'Invalid invoice data' };
    if (!items || items.length === 0) return { error: 'At least one item is required' };

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id, is_super_admin').eq('auth_user_id', userData.user?.id).single();
    if (!emp) return { error: 'Employee not found' };

    const { data: hasAccess } = await supabase.rpc('has_project_access', { p_project_id: parsed.data.project_id });
    if (!hasAccess && !emp.is_super_admin) return { error: 'لا تملك صلاحية على هذا المشروع' };

    const { data: vendorAccess } = await supabase
      .from('vendors')
      .select('kind, all_projects, vendor_project_access(project_id)')
      .eq('id', parsed.data.vendor_id)
      .single();
    
    if (!vendorAccess) return { error: 'Vendor not found' };

    // ── Business rule: invoices are for suppliers (مورد) only ──
    if (vendorAccess.kind !== 'vendor') {
      return { error: 'لا يمكن إنشاء فاتورة لمقاول — الفواتير مخصصة للموردين (توريدات) فقط' };
    }

    if (!vendorAccess.all_projects) {
      const allowedProjects = vendorAccess.vendor_project_access?.map((p: any) => p.project_id) || [];
      if (!allowedProjects.includes(parsed.data.project_id)) {
        return { error: 'هذا المورد غير مصرح له بالعمل في هذا المشروع' };
      }
    }

    // Insert Invoice Header
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        ...parsed.data,
      })
      .select('id')
      .single();

    if (invoiceError) return { error: invoiceError.message };

    // Insert Items (trigger will calculate totals)
    const dbItems = items.map(item => ({
      invoice_id: invoiceData.id,
      description: item.description,
      qty: item.qty,
      unit_price: item.unit_price,
      line_total: item.qty * item.unit_price,
      warehouse_id: item.warehouse_id || null,
      item_id: item.item_id || null,
    }));

    const { error: itemsError } = await supabase.from('invoice_items').insert(dbItems);
    if (itemsError) {
      // Rollback
      await supabase.from('invoices').delete().eq('id', invoiceData.id);
      return { error: itemsError.message };
    }

    if (attachmentUrls && attachmentUrls.length > 0) {
      const attachRows = attachmentUrls.map(url => ({
        entity_type: 'invoice',
        entity_id: invoiceData.id,
        r2_key: url,
        uploaded_by: emp.id,
      }));
      await supabase.from('attachments').insert(attachRows);
    }

    await logAudit({
      employee_id: emp.id,
      action: 'create',
      entity_type: 'invoice',
      entity_id: invoiceData.id,
      after: { ...parsed.data, items: dbItems },
    });

    // Notify approvers
    const { data: approvers } = await supabase.from('employees').select('id').or('is_super_admin.eq.true,can_approve.eq.true');
    if (approvers && approvers.length > 0) {
      const approverIds = approvers.map(a => a.id);
      await sendPushNotification(
        approverIds,
        'فاتورة جديدة بانتظار الاعتماد',
        `تم تقديم فاتورة جديدة للمقاول ${parsed.data.vendor_id}`,
        '/invoices',
        'invoice_submitted'
      );
    }

    revalidatePath('/invoices');
    revalidatePath('/projects', 'layout');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'An error occurred' };
  }
}

export async function approveInvoice(invoiceId: string) {
  try {
    const supabase = await createClient();

    const { data: invoiceRecord } = await supabase.from('audit_log').select('employee_id').eq('entity_type', 'invoice').eq('entity_id', invoiceId).eq('action', 'create').single();

    const { error } = await supabase.rpc('approve_invoice', { p_invoice_id: invoiceId });
    if (error) return { error: error.message };
    
    if (invoiceRecord) {
       await sendPushNotification(
         [invoiceRecord.employee_id],
         'تم اعتماد الفاتورة',
         `تم اعتماد الفاتورة التي قدمتها`,
         `/invoices`,
         'invoice_approved'
       );
    }

    revalidatePath('/invoices');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

export async function rejectInvoice(invoiceId: string) {
  try {
    const supabase = await createClient();

    const { data: invoiceRecord } = await supabase.from('audit_log').select('employee_id').eq('entity_type', 'invoice').eq('entity_id', invoiceId).eq('action', 'create').single();

    const { error } = await supabase.rpc('reject_invoice', { p_invoice_id: invoiceId });
    if (error) return { error: error.message };
    
    if (invoiceRecord) {
       await sendPushNotification(
         [invoiceRecord.employee_id],
         'تم رفض الفاتورة',
         `تم رفض الفاتورة التي قدمتها`,
         `/invoices`,
         'invoice_rejected'
       );
    }

    revalidatePath('/invoices');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}
