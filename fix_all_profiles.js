// fix_all_profiles.js
// Links all auth users to the restored company
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qqpumzvcthfbebaqtaqv.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxcHVtenZjdGhmYmViYXF0YXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzNjI5NSwiZXhwIjoyMDk3MDEyMjk1fQ.uqjPx7kGrdNvMdIyaCcv4vHzJLrGLG3OxazsdNRiDF4";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// The restored company ID
const COMPANY_ID = "c779c3d0-4c36-47d9-96c4-3f856c30e0d5";

// The original admin user (oldest account - ahmed@megamaf.local)
const ADMIN_USER_ID = "971103d2-0a28-4533-b6f7-742323c6f6c8";

async function main() {
  console.log("=== Fix All Profiles ===\n");

  // Get all auth users
  const { data: usersData, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error("Failed to list users:", error.message);
    return;
  }

  const users = usersData.users;
  console.log(`Found ${users.length} auth users\n`);

  // Get existing profiles
  const { data: existingProfiles } = await supabase
    .from("profiles")
    .select("id");
  const existingIds = new Set((existingProfiles || []).map((p) => p.id));
  console.log(`Existing profiles: ${existingIds.size}\n`);

  // Create missing profiles
  for (const user of users) {
    if (existingIds.has(user.id)) {
      console.log(`✅ Already has profile: ${user.email}`);
      continue;
    }

    const isAdmin = user.id === ADMIN_USER_ID;
    const role = isAdmin ? "admin" : "member";
    const fullName =
      user.user_metadata?.full_name || user.email?.split("@")[0] || "User";

    const { error: insertErr } = await supabase.from("profiles").insert([
      {
        id: user.id,
        company_id: COMPANY_ID,
        role: role,
        full_name: fullName,
      },
    ]);

    if (insertErr) {
      console.error(`❌ Failed for ${user.email}:`, insertErr.message);
    } else {
      console.log(`✅ Created profile for ${user.email} (role: ${role})`);
    }
  }

  console.log("\n🎉 All profiles restored!");
  
  // Final summary
  const { data: finalProfiles } = await supabase
    .from("profiles")
    .select("id, full_name, role");
  console.log("\nFinal profiles:", finalProfiles);
}

main().catch(console.error);
