import { checkGoldRuntime } from '@/lib/supabase/gold-runtime-probe.mjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export async function GET(request: Request) {
  const result = await checkGoldRuntime(process.env, request.headers.get('x-adp-gold-runtime'))
  return Response.json(result, { status: result.ok ? 200 : result.code.endsWith('-DISABLED') ? 404 : 503, headers })
}
