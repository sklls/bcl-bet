'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else router.push('/')
    } else {
      if (!name.trim()) {
        setError('Please enter your display name.')
        setLoading(false)
        return
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name.trim() } },
      })
      if (error) {
        setError(error.message)
      } else if (data.session) {
        router.push('/')
      } else {
        setMessage('Account created! Check your email to confirm before signing in.')
      }
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-baize flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-table rounded-2xl p-8 shadow-xl border border-rail">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-amber">PrimeStake</h1>
          <p className="text-slate mt-1 italic">Luck is for the Unprepared</p>
        </div>

        <div className="flex rounded-lg overflow-hidden mb-6 bg-baize">
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-amber text-white' : 'text-slate hover:text-white'}`}
            onClick={() => { setMode('login'); setError(''); setMessage('') }}
          >
            Sign In
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'signup' ? 'bg-amber text-white' : 'text-slate hover:text-white'}`}
            onClick={() => { setMode('signup'); setError(''); setMessage('') }}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Display Name (e.g. Rahul K)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="w-full px-4 py-3 bg-raised border border-rail rounded-lg text-white placeholder-slate-faded focus:outline-none focus:ring-2 focus:ring-amber"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'username' : 'email'}
            className="w-full px-4 py-3 bg-raised border border-rail rounded-lg text-white placeholder-slate-faded focus:outline-none focus:ring-2 focus:ring-amber"
          />
          <input
            type="password"
            placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 6 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full px-4 py-3 bg-raised border border-rail rounded-lg text-white placeholder-slate-faded focus:outline-none focus:ring-2 focus:ring-amber"
          />

          {error && <p className="text-crimson-light text-sm">{error}</p>}
          {message && <p className="text-amber text-sm">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-amber hover:bg-amber-deep disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {mode === 'signup' && (
          <p className="text-xs text-slate text-center mt-4">
            Your account will need to be topped up by an admin before you can place bets.
          </p>
        )}
      </div>
    </div>
  )
}
