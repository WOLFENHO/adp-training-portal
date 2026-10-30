import Link from 'next/link'
import type { Member } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
export function Header({ member }: { member?: Member | null }) {
  return <header className="topbar"><Link href={member ? '/library' : '/'} className="brand">ANALYTICS DEVELOPMENT PROGRAM<small>INTERNAL TRAINING PORTAL</small></Link>{member && <div className="user-nav">{member.is_admin && <Link href="/admin">Admin</Link>}{member.avatar_url ? <img src={member.avatar_url} className="avatar" alt="" /> : <span className="avatar"/>}<span>{member.username}</span><form action={async()=>{'use server'; const supabase=await createClient(); await supabase.auth.signOut(); const {redirect}=await import('next/navigation'); redirect('/') }}><button className="button secondary">Sign out</button></form></div>}</header>
}
