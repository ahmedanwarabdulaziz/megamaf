import bcrypt from 'bcryptjs';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function hashPin(pin: string): Promise<string> {
  return await bcrypt.hash(pin, 10);
}

export async function verifyPin(employeeId: string, username: string, pin: string, pinHash: string): Promise<boolean> {
  const isMatch = await bcrypt.compare(pin, pinHash);
  
  if (!isMatch) {
    await handleFailedAttempt(employeeId, username);
    return false;
  }
  
  await resetFailedAttempts(employeeId);
  return true;
}

export async function checkLockout(lockedUntil: string | null): Promise<{ locked: boolean; unlockTime?: Date }> {
  if (!lockedUntil) return { locked: false };
  const lockedDate = new Date(lockedUntil);
  if (lockedDate > new Date()) {
    return { locked: true, unlockTime: lockedDate };
  }
  return { locked: false };
}

async function handleFailedAttempt(employeeId: string, username: string) {
  const supabase = await createClient();
  const adminClient = createAdminClient();
  
  // Get current attempts and policy
  const { data: settings } = await supabase.from('app_settings').select('value').eq('key', 'lockout_policy').single();
  const policy = (settings?.value as { max_attempts: number; lockout_minutes: number }) || { max_attempts: 5, lockout_minutes: 15 };
  
  const { data: secret } = await adminClient.from('employee_secrets').select('failed_pin_attempts').eq('employee_id', employeeId).single();

  const currentAttempts = (secret?.failed_pin_attempts || 0) + 1;
  const updatePayload: any = { failed_pin_attempts: currentAttempts };

  if (currentAttempts >= policy.max_attempts) {
    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + policy.lockout_minutes);
    updatePayload.locked_until = lockedUntil.toISOString();
    
    // Audit log the lockout
    await adminClient.from('audit_log').insert({
      employee_id: employeeId,
      action: 'update',
      entity_type: 'employee',
      entity_id: employeeId,
      after: { locked_until: updatePayload.locked_until }
    });
  }

  await adminClient.from('employee_secrets').update(updatePayload).eq('employee_id', employeeId);
}

export async function resetFailedAttempts(employeeId: string) {
  const adminClient = createAdminClient();
  await adminClient.from('employee_secrets').update({ failed_pin_attempts: 0, locked_until: null }).eq('employee_id', employeeId);
}
