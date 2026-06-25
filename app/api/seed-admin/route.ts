import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashPin } from '@/lib/auth/pin'
import crypto from 'crypto'

export async function GET() {
  try {
    const adminClient = createAdminClient()
    
    // Check if any super admin already exists
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

    // Create the underlying auth user in Supabase
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: `${username}@megamaf.local`,
      password: crypto.randomUUID(),
      email_confirm: true
    })

    if (authError) throw authError

    // 2. Create the Employee Profile
    const { data: employee, error: employeeError } = await adminClient.from('employees').insert({
      auth_user_id: authUser.user.id,
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

    // 3. Create secrets
    const { error: secretsError } = await adminClient.from('employee_secrets').insert({
      employee_id: employee.id,
      pin_hash
    })

    if (secretsError) {
      return NextResponse.json({ error: secretsError.message }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true,
      message: 'Admin account created successfully!', 
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
