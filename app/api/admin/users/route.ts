import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

async function verifyAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function GET() {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  // Fetch all auth users (source of truth — includes users whose profile trigger may have failed)
  const { data: authUsers, error: authError } = await admin.auth.admin.listUsers()
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  // Fetch existing profiles
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name, wallet_balance, role')
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

  // For any auth user missing a profile row, create it now
  const missing = (authUsers?.users ?? []).filter((u) => !profileMap.has(u.id))
  for (const u of missing) {
    const display_name =
      u.user_metadata?.full_name ||
      u.user_metadata?.name ||
      u.email?.split('@')[0] ||
      'User'
    const { data: newProfile } = await admin
      .from('profiles')
      .insert({ id: u.id, display_name, role: 'user', wallet_balance: 0 })
      .select('id, display_name, wallet_balance, role')
      .single()
    if (newProfile) profileMap.set(newProfile.id, newProfile)
  }

  const result = Array.from(profileMap.values()).sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  )

  return NextResponse.json(result)
}

// DELETE /api/admin/users?id=<user_id>  — resets wallet to 0
export async function DELETE(request: Request) {
  const admin_user = await verifyAdmin()
  if (!admin_user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('id')
  if (!userId) return NextResponse.json({ error: 'Missing user id' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.rpc('reset_wallet', {
    p_user_id: userId,
    p_description: 'Wallet reset by admin',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
