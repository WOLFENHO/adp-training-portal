import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { adminDb } from '@/lib/supabase/admin'

export type Member = { id: string; discord_id: string; username: string; avatar_url: string | null; is_admin: boolean }
export type MemberResolution =
  | { status: 'authenticated'; member: Member }
  | { status: 'no_session' | 'session_error' | 'profile_missing' | 'identity_mismatch' | 'not_whitelisted' | 'authorization_error' }

type DiscordUser = { id: string; identities?: { id: string; provider: string; identity_data?: Record<string, unknown> | null }[] | null; user_metadata?: Record<string, unknown> }
function discordIdentity(user: DiscordUser) { return user.identities?.find(identity => identity.provider === 'discord') ?? null }

export async function resolveMember(): Promise<MemberResolution> {
  const supabase = await createClient()
  const { data: { user }, error: sessionError } = await supabase.auth.getUser()
  if (sessionError) return { status: 'session_error' }
  if (!user) return { status: 'no_session' }
  const { data: profile, error: profileError } = await adminDb.from('profiles').select('id,discord_id,username,avatar_url').eq('id', user.id).maybeSingle()
  if (profileError) return { status: 'authorization_error' }
  if (!profile) return { status: 'profile_missing' }
  const identity = discordIdentity(user)
  if (!identity || identity.id !== profile.discord_id) return { status: 'identity_mismatch' }
  const id = profile.discord_id
  const [{ data: access, error: accessError }, { data: role, error: roleError }] = await Promise.all([
    adminDb.from('authorized_discord_ids').select('discord_id').eq('discord_id', id).maybeSingle(),
    adminDb.from('administrator_roles').select('discord_id').eq('discord_id', id).maybeSingle(),
  ])
  if (accessError || roleError) return { status: 'authorization_error' }
  if (!access) return { status: 'not_whitelisted' }
  return { status: 'authenticated', member: { ...profile, is_admin: Boolean(role) } as Member }
}

export async function getMember() {
  const result = await resolveMember()
  return result.status === 'authenticated' ? result.member : null
}
export async function requireMember() { const m = await getMember(); if (!m) redirect('/access-denied'); return m }
export async function requireAdmin() { const m = await requireMember(); if (!m.is_admin) redirect('/library'); return m }

export async function syncDiscordProfile(user: DiscordUser) {
  const identity = discordIdentity(user)
  if (!identity) throw new Error('Discord identity is missing')
  const id = identity.id
  const meta = identity.identity_data ?? {}
  const fallback = user.user_metadata ?? {}
  const username = String(meta.username ?? meta.global_name ?? meta.name ?? fallback.user_name ?? fallback.name ?? `discord-${id}`)
  const avatar = typeof meta.avatar_url === 'string' ? meta.avatar_url : typeof fallback.avatar_url === 'string' ? fallback.avatar_url : null
  const { error } = await adminDb.from('profiles').upsert({ id: user.id, discord_id: id, username, avatar_url: avatar }, { onConflict: 'id' })
  if (error) throw error
  if (process.env.INITIAL_ADMIN_DISCORD_ID === id) {
    const role = await adminDb.from('administrator_roles').upsert({ discord_id: id, granted_by: id }, { onConflict: 'discord_id' })
    const access = await adminDb.from('authorized_discord_ids').upsert({ discord_id: id, added_by: id }, { onConflict: 'discord_id' })
    if (role.error || access.error) throw role.error ?? access.error
  }
}
