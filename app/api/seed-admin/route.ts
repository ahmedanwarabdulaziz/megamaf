import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashPin } from '@/lib/auth/pin'
import crypto from 'crypto'

export async function GET() {
  try {
    const adminClient = createAdminClient()
    
    // Check if any super admin already exists in the employees table
    const { data: existingAdmin, error: fetchError } = await adminClient
      .from('employees')
      .select('id')
      .eq('is_super_admin', true)
      .limit(1)
      .maybeSingle()
      
    if (fetchError) throw fetchError

    if (existingAdmin) {
      return NextResponse.json({ message: 'A super admin already exists in the database. Please use that account.' })
    }

    const username = 'admin'
    const pin = '123456'
    const pin_hash = await hashPin(pin)
    const email = `${username}@megamaf.local`

    // Try to create the auth user. If the email already exists (e.g. after a
    // data reset that truncated employees but kept auth.users), find and reuse it.
    let authUserId: string

    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
    })

    if (authError) {
      // If creation failed because the user already exists, look them up
      if (authError.message?.toLowerCase().includes('already') || authError.status === 422) {
        const { data: listData, error: listError } = await adminClient.auth.admin.listUsers()
        if (listError) throw listError
        const existing = listData.users.find(u => u.email === email)
        if (!existing) throw new Error(`Auth user not found for email: ${email}`)
        authUserId = existing.id
      } else {
        throw authError
      }
    } else {
      authUserId = authUser.user.id
    }

    // Clean up any stale employee rows for this username (e.g. from repeated resets)
    await adminClient.from('employees').delete().eq('username', username)

    // Create the Employee Profile
    const { data: employee, error: employeeError } = await adminClient.from('employees').insert({
      auth_user_id: authUserId,
      username,
      full_name: 'مدير النظام (الأساسي)',
      role: 'owner',
      is_super_admin: true,
      can_approve: true,
      is_active: true
    }).select().single()

    if (employeeError) {
      return NextResponse.json({ error: employeeError.message }, { status: 500 })
    }

    // Create secrets
    const { error: secretsError } = await adminClient.from('employee_secrets').insert({
      employee_id: employee.id,
      pin_hash
    })

    if (secretsError) {
      return NextResponse.json({ error: secretsError.message }, { status: 500 })
    }

    // Re-seed MAF Main Company — this mandatory root project is created by the
    // migration but gets wiped by RESET_DATA.sql along with other projects rows.
    const { error: projectError } = await adminClient.from('projects').upsert({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'MAF Main Company',
      code: 'MAIN',
      node_type: 'main_company',
      is_main: true,
      status: 'open',
    }, { onConflict: 'id' })

    if (projectError) {
      return NextResponse.json({ error: `Admin created but failed to seed main project: ${projectError.message}` }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      message: 'Admin account and MAF Main Company created successfully!', 
      credentials: {
        username: username,
        pin: pin
      }
    })

  } catch (error: any) {
    console.error('Seed Admin Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
