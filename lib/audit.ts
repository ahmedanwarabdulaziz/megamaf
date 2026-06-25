import { createClient } from '@/lib/supabase/server';

export type AuditAction = 'create' | 'update' | 'delete' | 'approve' | 'login' | 'logout';

interface AuditParams {
  employee_id?: string;
  action: AuditAction;
  entity_type: string;
  entity_id?: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
  ip?: string;
}

/**
 * Log an action to the audit_log table.
 * All mutations in the app should call this helper to maintain a complete history.
 */
export async function logAudit(params: AuditParams) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from('audit_log').insert({
      employee_id: params.employee_id,
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id,
      before: params.before,
      after: params.after,
      ip: params.ip,
    });

    if (error) {
      console.error('Audit log insertion failed:', error);
    }
  } catch (err) {
    console.error('Audit log exception:', err);
  }
}
