import { NextResponse } from 'next/server'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { playbackToken } from '@/lib/mux'
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const member=await getMember();if(!member)return NextResponse.json({error:'forbidden'},{status:403});const{id}=await params;const{data:v}=await adminDb.from('videos').select('playback_id,published').eq('id',id).maybeSingle();if(!v?.playback_id||(!v.published&&!member.is_admin))return NextResponse.json({error:'not found'},{status:404});return NextResponse.json({token:await playbackToken(v.playback_id)})}
