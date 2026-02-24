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
        // Email confirmation is off — user is logged in immediately
        router.push('/')
      } else {
        // Email confirmation is on
        setMessage('Account created! Check your email to confirm before signing in.')
      }
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl p-8 shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-green-400">BCL Bet</h1>
          <p className="text-gray-400 mt-1">College Cricket Tournament</p>
        </div>

        {/* Tab toggle */}
        <div className="flex rounded-lg overflow-hidden mb-6 bg-gray-800">
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-green-500 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => { setMode('login'); setError(''); setMessage('') }}
          >
            Sign In
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === 'signup' ? 'bg-green-500 text-white' : 'text-gray-400 hover:text-white'}`}
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
              className="w-full px-4 py-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'username' : 'email'}
            className="w-full px-4 py-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="password"
            placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 6 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full px-4 py-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {message && <p className="text-green-400 text-sm">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {mode === 'signup' && (
          <p className="text-xs text-gray-600 text-center mt-4">
            Your account will need to be topped up by an admin before you can place bets.
          </p>
        )}
      </div>
    </div>
  )
}
