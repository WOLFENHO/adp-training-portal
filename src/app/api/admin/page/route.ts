import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { pageAdminRows } from '@/lib/admin-keyset.mjs'

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }
const querySchema = z.object({ view: z.enum(['videos', 'profiles', 'progress']), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(400).nullable() })

export async function GET(request: Request) {
  const correlationId = randomUUID()
  const fail = (status: number, error: string) => NextResponse.json({ error, errorId: error === 'forbidden' ? 'ADP-AUTH-003' : 'ADP-ADM-002', correlationId }, { status, headers })
  const member = await getMember()
  if (!member?.is_admin) return fail(403, 'forbidden')
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ view: url.searchParams.get('view'), limit: url.searchParams.get('limit') ?? 50, cursor: url.searchParams.get('cursor') })
  if (!parsed.success) return fail(400, 'invalid_request')
  try {
    const page = await pageAdminRows(adminDb, parsed.data)
    return NextResponse.json(page, { headers })
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid cursor') return fail(400, 'invalid_cursor')
    console.error('[ADP admin] paged read failed', { correlationId, errorId: 'ADP-ADM-002' })
    return fail(503, 'admin_data_unavailable')
  }
}
