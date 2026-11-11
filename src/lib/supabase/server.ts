import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const store = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values: { name: string; value: string; options: import('@supabase/ssr').CookieOptions }[]) {
        try {
          values.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch (error) {
          // Server Components cannot mutate cookies; callback Route Handlers can.
          console.warn('[ADP auth] Supabase cookie write was unavailable', {
            name: error instanceof Error ? error.name : 'UnknownError',
          })
        }
      },
    },
  })
}
