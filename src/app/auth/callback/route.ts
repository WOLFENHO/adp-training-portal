import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncDiscordProfile, getMember } from '@/lib/auth'
export async function GET(request: Request) { const u=new URL(request.url),base=process.env.NEXT_PUBLIC_APP_URL!; const code=u.searchParams.get('code'); if(code){const supabase=await createClient(); const {data,error}=await supabase.auth.exchangeCodeForSession(code); if(!error&&data.user){try{await syncDiscordProfile(data.user)}catch{return NextResponse.redirect(new URL('/access-denied?error=profile',base))} const m=await getMember(); return NextResponse.redirect(new URL(m?'/library':'/access-denied',base))}} return NextResponse.redirect(new URL('/?error=oauth',base)) }
