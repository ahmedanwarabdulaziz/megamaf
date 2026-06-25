import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function rotateSession(employeeId: string, device: string, ip: string) {
  const supabase = await createClient();
  const newSessionId = crypto.randomUUID();
  
  // Create a record in user_sessions
  await supabase.from('user_sessions').insert({
    employee_id: employeeId,
    token_hash: newSessionId,
    device,
    ip,
  });
  
  // Update employees.active_session_id
  await supabase.from('employees').update({ active_session_id: newSessionId }).eq('id', employeeId);
  
  // Clean up old sessions
  await supabase.from('user_sessions').delete().eq('employee_id', employeeId).neq('token_hash', newSessionId);
  
  return newSessionId;
}

export async function validateSession(employeeId: string, sessionId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('employees').select('active_session_id').eq('id', employeeId).single();
  
  return data?.active_session_id === sessionId;
}
