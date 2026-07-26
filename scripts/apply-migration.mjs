/**
 * Apply a .sql migration to the linked Supabase project via the Management API.
 * Needs a personal access token (SUPABASE_ACCESS_TOKEN, or ~/.supabase creds).
 *
 *   node scripts/apply-migration.mjs supabase/migrations/003_fantasy_foundation.sql
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/apply-migration.mjs <file.sql>'); process.exit(1) }

const PROJECT_REF = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim()

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const envFile = '.env.local'
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)
    if (m) return m[1].trim()
  }
  // supabase CLI stores the token in the OS credential store on Windows, but
  // falls back to a plaintext file when that is unavailable.
  const p = path.join(os.homedir(), '.supabase', 'access-token')
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim()
  throw new Error('no access token found — set SUPABASE_ACCESS_TOKEN')
}

const sql = fs.readFileSync(file, 'utf8')
console.log(`applying ${file} to ${PROJECT_REF} (${sql.split('\n').length} lines)\n`)

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})

const text = await res.text()
if (!res.ok) { console.error(`FAILED ${res.status}:`, text); process.exit(1) }
console.log('OK:', text || '(no rows returned)')
