import { NextResponse } from 'next/server'
import { getMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
 const member=await getMember();
 if(!member)return NextResponse.json({error:'forbidden',reason:'member session missing or access whitelist revoked'},{status:403});
 if(process.env.PLAYBACK_HEARTBEATS_ENABLED!=='true')return NextResponse.json({error:'playback_maintenance',reason:'verified playback is temporarily disabled'},{status:503});
 const{id}=await params;if(!z.string().uuid().safeParse(id).success)return NextResponse.json({error:'invalid_request'},{status:400,headers:{'Cache-Control':'private, no-store, max-age=0'}});const supabase=await createClient();
 const{data:release,error:releaseError}=await supabase.rpc('adp_playback_integrity_version');
 if(releaseError||release!==121){console.error('[ADP playback] Release 1.2 schema unavailable',{code:releaseError?.code,message:releaseError?.message,version:release??null});return NextResponse.json({error:'playback_schema_unavailable',reason:'Release 1.2 database migrations are incomplete'},{status:503})}
 const{data,error}=await supabase.rpc('start_playback_session_r12',{p_video_id:id});
 if(error){const status=error.message==='not authorized'?403:error.message.includes('video')?400:503;console.error('[ADP playback] session creation rejected',{userId:member.id,videoId:id,status,reason:error.message,at:new Date().toISOString()});return NextResponse.json({error:error.message,reason:'playback session validation rejected this request'},{status})}
 return NextResponse.json(data)
}
