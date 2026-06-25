import { createClient } from '@/lib/supabase/server';

export async function getProjects() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('name');
  
  if (error) throw error;
  return data;
}
