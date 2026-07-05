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
    <div className="min-h-screen bg-[#0D1730] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#162244] rounded-2xl p-8 shadow-xl border border-[#243568]">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#F07820]">BPL Bet</h1>
          <p className="text-[#7a91c4] mt-1">College Cricket Tournament</p>
        </div>

        <div className="flex rounded-lg overflow-hidden mb-6 bg-[#0D1730]">
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-[#F07820] text-white' : 'text-[#7a91c4] hover:text-white'}`}
            onClick={() => { setMode('login'); setError(''); setMessage('') }}
          >
            Sign In
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'signup' ? 'bg-[#F07820] text-white' : 'text-[#7a91c4] hover:text-white'}`}
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
              className="w-full px-4 py-3 bg-[#1E2E52] border border-[#243568] rounded-lg text-white placeholder-[#5a7099] focus:outline-none focus:ring-2 focus:ring-[#F07820]"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'username' : 'email'}
            className="w-full px-4 py-3 bg-[#1E2E52] border border-[#243568] rounded-lg text-white placeholder-[#5a7099] focus:outline-none focus:ring-2 focus:ring-[#F07820]"
          />
          <input
            type="password"
            placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 6 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full px-4 py-3 bg-[#1E2E52] border border-[#243568] rounded-lg text-white placeholder-[#5a7099] focus:outline-none focus:ring-2 focus:ring-[#F07820]"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {message && <p className="text-[#F07820] text-sm">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#F07820] hover:bg-[#D96A18] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {mode === 'signup' && (
          <p className="text-xs text-[#5a7099] text-center mt-4">
            Your account will need to be topped up by an admin before you can place bets.
          </p>
        )}
      </div>
    </div>
  )
}
