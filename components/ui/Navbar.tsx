'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [user, setUser] = useState<{ email: string | null; role?: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return setUser(null)
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, display_name')
        .eq('id', user.id)
        .single()
      setUser({ email: user.email ?? null, role: profile?.role })
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setUser(null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const navLink = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      className={`text-sm font-medium transition-colors ${
        pathname === href ? 'text-[#F07820]' : 'text-[#7a91c4] hover:text-white'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="border-b border-[#243568] bg-[#0D1730] sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-[#F07820] font-bold text-lg tracking-tight">
          BPL Bet
        </Link>

        <div className="flex items-center gap-6">
          {navLink('/', 'Sports')}
          {navLink('/leaderboard', 'Leaderboard')}
          {user && navLink('/dashboard', 'My Bets')}
          {user?.role === 'admin' && navLink('/admin', 'Admin')}
          {user?.role === 'admin' && navLink('/admin/ledger', 'Ledger')}

          {user ? (
            <button
              onClick={handleSignOut}
              className="text-sm text-[#7a91c4] hover:text-[#C41E28] transition-colors"
            >
              Sign Out
            </button>
          ) : (
            navLink('/login', 'Sign In')
          )}
        </div>
      </div>
    </nav>
  )
}
