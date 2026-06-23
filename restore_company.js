// restore_company.js
// This script restores the deleted company record and fixes orphaned profiles
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qqpumzvcthfbebaqtaqv.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxcHVtenZjdGhmYmViYXF0YXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzNjI5NSwiZXhwIjoyMDk3MDEyMjk1fQ.uqjPx7kGrdNvMdIyaCcv4vHzJLrGLG3OxazsdNRiDF4";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log("=== MegaMaf Company Restore Tool ===\n");

  // Step 1: Check current state of companies table
  console.log("1️⃣  Checking companies table...");
  const { data: companies, error: companiesErr } = await supabase
    .from("companies")
    .select("*");

  if (companiesErr) {
    console.error("❌ Error reading companies:", companiesErr.message);
    return;
  }
  console.log(`   Found ${companies.length} company record(s):`, companies);

  // Step 2: Check profiles to find orphaned users
  console.log("\n2️⃣  Checking profiles...");
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("*");

  if (profilesErr) {
    console.error("❌ Error reading profiles:", profilesErr.message);
    return;
  }
  console.log(`   Found ${profiles.length} profile(s):`, profiles);

  // Step 3: Check auth users
  console.log("\n3️⃣  Checking auth users...");
  const { data: usersData, error: usersErr } =
    await supabase.auth.admin.listUsers();
  if (usersErr) {
    console.error("❌ Error reading users:", usersErr.message);
    return;
  }
  const users = usersData.users;
  console.log(`   Found ${users.length} auth user(s):`);
  users.forEach((u) =>
    console.log(`   - ${u.email} (id: ${u.id}, created: ${u.created_at})`)
  );

  if (companies.length > 0) {
    console.log(
      "\n✅ A company already exists! No restore needed. Your company ID is:",
      companies[0].id
    );
    return;
  }

  // Step 4: No company found — restore it
  console.log("\n4️⃣  No company found. Creating new company record...");
  const { data: newCompany, error: insertErr } = await supabase
    .from("companies")
    .insert([{ name: "My Company", default_currency: "EGP" }])
    .select()
    .single();

  if (insertErr) {
    console.error("❌ Failed to insert company:", insertErr.message);
    return;
  }
  console.log("   ✅ Company created:", newCompany);

  // Step 5: Update orphaned profiles to point to the new company
  if (profiles.length > 0) {
    console.log(
      `\n5️⃣  Updating ${profiles.length} orphaned profile(s) to point to new company...`
    );
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ company_id: newCompany.id })
      .neq("id", "00000000-0000-0000-0000-000000000000"); // update all

    if (updateErr) {
      console.error("❌ Failed to update profiles:", updateErr.message);
    } else {
      console.log("   ✅ All profiles updated!");
    }
  } else if (users.length > 0) {
    // No profiles exist either — create profile for the first admin user
    console.log(
      "\n5️⃣  No profiles found. Creating admin profile for the first user..."
    );
    const adminUser = users[0];
    const { error: profileErr } = await supabase.from("profiles").insert([
      {
        id: adminUser.id,
        company_id: newCompany.id,
        role: "admin",
        full_name:
          adminUser.user_metadata?.full_name || adminUser.email || "Admin",
      },
    ]);
    if (profileErr) {
      console.error("❌ Failed to create profile:", profileErr.message);
    } else {
      console.log(
        `   ✅ Admin profile created for ${adminUser.email || adminUser.id}`
      );
    }
  }

  // Step 6: Also ensure the company branch project exists
  console.log("\n6️⃣  Checking company branch project (الشركة)...");
  const { data: branch, error: branchErr } = await supabase
    .from("projects")
    .select("*")
    .eq("company_id", newCompany.id)
    .eq("is_company_branch", true);

  if (branchErr) {
    console.warn("   ⚠️  Could not check branch:", branchErr.message);
  } else if (!branch || branch.length === 0) {
    console.log("   Creating company branch project...");
    const { error: branchInsertErr } = await supabase.from("projects").insert([
      {
        company_id: newCompany.id,
        name: "الشركة",
        status: "active",
        is_company_branch: true,
      },
    ]);
    if (branchInsertErr) {
      console.error(
        "   ❌ Failed to create branch:",
        branchInsertErr.message
      );
    } else {
      console.log("   ✅ Company branch project created!");
    }
  } else {
    console.log("   ✅ Company branch already exists.");
  }

  console.log("\n🎉 Restore complete! Please refresh your app.");
  console.log("   New Company ID:", newCompany.id);
}

main().catch(console.error);
