import { createClient } from '@supabase/supabase-js'
import { assertSupabaseIsolation } from './preview-isolation.mjs'
assertSupabaseIsolation(process.env)
export const adminDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
