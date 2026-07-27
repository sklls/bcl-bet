// ── Server-only Supabase clients ───────────────────────────
// This file imports next/headers — only use in Server Components & API routes
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export function createServerSupabaseClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          try {
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
          } catch {
            // Ignore — middleware handles session refresh
          }
        },
        remove(name: string, options: Record<string, unknown>) {
          try {
            cookieStore.set(name, '', options as Parameters<typeof cookieStore.set>[2])
          } catch {
            // Ignore
          }
        },
      },
    }
  )
}

// Anon, cookie-less client for public reads (no auth, no next/headers).
// Safe to use in statically-rendered / ISR pages that only read public data.
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        // Next patches global fetch and stores GET responses in its Data Cache.
        // `export const dynamic = 'force-dynamic'` re-renders the page but does
        // NOT stop that fetch being replayed from cache — which is how the
        // fantasy contest list kept serving "no contests yet" long after one
        // existed, while the cookie-reading anon client on the same data
        // reported it correctly.
        //
        // Every read through this client is live state: contest status, wallet
        // balances, settlement results. None of it may come from a cache.
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
    }
  )
}
