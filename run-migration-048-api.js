const https = require('https');
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

const sql = fs.readFileSync('./supabase/migrations/0048_owner_prior_dues.sql', 'utf8');

// Use Supabase Management API to run SQL
const body = JSON.stringify({ query: sql });
const options = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Length': Buffer.byteLength(body),
  },
};

console.log(`Running migration on project: ${PROJECT_REF}`);

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✅ Migration applied successfully!');
    } else {
      console.log(`❌ Status ${res.statusCode}:`, data.substring(0, 500));
      console.log('\nPlease run the migration manually via the Supabase SQL editor.');
    }
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(body);
req.end();
