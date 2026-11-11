import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const url=process.env.ADP_TEST_DATABASE_URL
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||process.env.ADP_ALLOW_LOCAL_DB_TEST!=='1')throw Error('Requires opted-in disposable loopback database')
function run(sql,onLine){return new Promise((resolve,reject)=>{const child=spawn('psql',['-X','-At','-v','ON_ERROR_STOP=1',url,'-c',sql]);let output='',error='';child.stdout.on('data',data=>{output+=data;onLine?.(output)});child.stderr.on('data',data=>error+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error('psql failed: '+error)))})}
const uid=randomUUID(),vid=randomUUID(),sid=randomUUID(),discord='98'+Date.now()
const auth=`set local role authenticated;select set_config('request.jwt.claim.sub','${uid}',true);select set_config('request.jwt.claim.role','authenticated',true);`
const hb=(id,version,seq,position,playing,kind)=>`select public.record_playback_heartbeat_r12('${sid}','${id}',${version},${seq},${position},${playing},'${kind}');`
try{
 await run(`begin;update public.adp_playback_control set enabled=true;insert into auth.users(id)values('${uid}');insert into public.profiles(id,discord_id,username)values('${uid}','${discord}','concurrency');insert into public.authorized_discord_ids(discord_id,added_by)values('${discord}','test');insert into public.administrator_roles(discord_id,granted_by)values('${discord}','test');insert into public.videos(id,title,asset_id,duration_seconds,duration_precision_verified,published)values('${vid}','concurrency','${vid}',100,true,true);insert into public.playback_sessions(id,user_id,video_id,asset_identity,is_playing,active_since)select '${sid}','${uid}',id,public.adp_asset_identity(v),true,clock_timestamp()-interval '2 seconds' from public.videos v where id='${vid}';commit;`)
 let unlock;const locked=new Promise(resolve=>unlock=resolve)
 const heartbeat=run(`begin;${auth}${hb(randomUUID(),0,1,1,true,'periodic')}select 'HEARTBEAT_LOCKED';select pg_sleep(1);commit;`,output=>{if(output.includes('HEARTBEAT_LOCKED'))unlock()})
 await Promise.race([locked,new Promise((_,reject)=>setTimeout(()=>reject(Error('Lock checkpoint timeout')),10000))])
 const reset=run(`begin;${auth}select public.adp_admin_progress('${uid}','${vid}','progress-reset');commit;`)
 await Promise.all([heartbeat,reset])
 assert.equal((await run(`select count(*) from public.watched_intervals where video_id='${vid}' and reset_at is null;`)).trim(),'0')
 const rejected=await run(`begin;${auth}${hb(randomUUID(),2,2,2,true,'periodic')}commit;`)
 assert.match(rejected,/session_inactive/)
 assert.equal((await run(`select verified_watched_seconds from public.user_video_progress where video_id='${vid}';`)).trim(),'0.000')
 console.log('PASS real concurrent heartbeat/reset; retired evidence preserved and cannot be restored')
 // Fresh session, two independent active/pause transactions with the same version.
 await run(`update public.playback_sessions set active=true,is_playing=false,session_version=0,last_event_sequence=0,last_position=0 where id='${sid}';`)
 const results=await Promise.all([run(`begin;${auth}${hb(randomUUID(),0,3,0,true,'play')}commit;`),run(`begin;${auth}${hb(randomUUID(),0,4,0,false,'pause')}commit;`)])
 assert.equal(results.filter(r=>r.includes('"accepted": true')).length,1)
 assert.match(results.join(''),/stale_version|stale_event/)
 console.log('PASS real concurrent pause/resume compare-and-set ordering')
}finally{await run(`begin;delete from public.administrator_roles where discord_id='${discord}';delete from public.authorized_discord_ids where discord_id='${discord}';delete from public.videos where id='${vid}';delete from auth.users where id='${uid}';update public.adp_playback_control set enabled=false;commit;`)}
