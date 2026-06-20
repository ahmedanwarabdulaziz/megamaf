require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .limit(1);
    
  if (error) {
    console.error("Error fetching from projects:", error);
  } else {
    console.log("Successfully fetched projects:", data);
  }
}

checkProjects();
