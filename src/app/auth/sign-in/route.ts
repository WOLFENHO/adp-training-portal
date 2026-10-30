import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
export async function GET() { const base=process.env.NEXT_PUBLIC_APP_URL!; const supabase=await createClient(); const {data,error}=await supabase.auth.signInWithOAuth({provider:'discord',options:{redirectTo:`${base}/auth/callback`}}); if(error||!data.url)return NextResponse.redirect(new URL('/?error=oauth',base)); return NextResponse.redirect(data.url) }
