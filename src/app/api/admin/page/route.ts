import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { pageAdminRows } from '@/lib/admin-keyset.mjs'
import { enrichProgressPage } from '@/lib/admin-progress-page.mjs'
import { enrichCompletionPage } from '@/lib/admin-completion-page.mjs'
import { identifyError } from '@/lib/error-registry.mjs'

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }
const querySchema = z.object({ view: z.enum(['allowed', 'videos', 'profiles', 'progress', 'historical', 'verified']), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(400).nullable() })

export async function GET(request: Request) {
  const correlationId = randomUUID()
  const fail = (status: number, error: string) => NextResponse.json({ error, errorId: identifyError(error).errorId, correlationId }, { status, headers })
  if (!process.env.ADP_ADMIN_CURSOR_SECRET || Buffer.byteLength(process.env.ADP_ADMIN_CURSOR_SECRET, 'utf8') < 32) {
    console.error('[ADP admin] paging configuration unavailable', { correlationId, errorId: 'ADP-ADM-002' })
    return fail(503, 'admin_data_unavailable')
  }
  let member
  try { member = await getMember() } catch {
    console.error('[ADP admin] paged authorization unavailable', { correlationId, errorId: 'ADP-ADM-002' })
    return fail(503, 'admin_data_unavailable')
  }
  if (!member?.is_admin) return fail(403, 'forbidden')
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ view: url.searchParams.get('view'), limit: url.searchParams.get('limit') ?? 50, cursor: url.searchParams.get('cursor') })
  if (!parsed.success) return fail(400, 'invalid_request')
  if (['progress', 'historical', 'verified'].includes(parsed.data.view) && parsed.data.limit > 20) return fail(400, 'invalid_request')
  try {
    const page = await pageAdminRows(adminDb, { ...parsed.data, actorId: member.id })
    if (parsed.data.view === 'progress') page.rows = await enrichProgressPage(adminDb, page.rows)
    if (parsed.data.view === 'historical' || parsed.data.view === 'verified') page.rows = await enrichCompletionPage(adminDb, page.rows, parsed.data.view)
    if (parsed.data.view === 'profiles' && page.rows.length) {
      const ids = page.rows.map((row: any) => row.discord_id)
      const { data: authorized, error } = await adminDb.from('authorized_discord_ids').select('discord_id').in('discord_id', ids).limit(101)
      if (error || !Array.isArray(authorized) || authorized.length > 100) throw new Error('authorization labels unavailable')
      const allowed = new Set(authorized.map((row: any) => row.discord_id))
      page.rows = page.rows.map((row: any) => ({ ...row, isAuthorized: allowed.has(row.discord_id) }))
    }
    if (Buffer.byteLength(JSON.stringify(page), 'utf8') > 65536) throw new Error('dashboard page exceeds limit')
    return NextResponse.json(page, { headers })
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid cursor') return fail(400, 'invalid_cursor')
    console.error('[ADP admin] paged read failed', { correlationId, errorId: 'ADP-ADM-002' })
    return fail(503, 'admin_data_unavailable')
  }
}
