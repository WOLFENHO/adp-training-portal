import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
function route(file,ready){
 const calls=[]
 const forbidden=new Proxy({}, {get(){throw Error('Unexpected privileged mutation during maintenance')}})
 const load=id=>id==='@/lib/auth'?{getMember:async()=>({id:'11111111-1111-4111-8111-111111111111',is_admin:true})}:
 id==='@/lib/supabase/server'?{createClient:async()=>({rpc:async(name)=>{calls.push(name);return {data:ready,error:null}}})}:
 id==='@/lib/supabase/admin'?{adminDb:forbidden}:id==='@/lib/mux'?{mux:forbidden,playbackToken:()=>{throw Error('Unexpected playback token during maintenance')}}:
 id==='@/lib/playback-gate'?evaluate('src/lib/playback-gate.ts'):
 id==='@/lib/api-errors.mjs'?{sameOriginMutation:()=>true,safeSessionRpcError:()=>({status:503,code:'session_unavailable',errorId:'ADP-PRG-004'}),sanitizeHeartbeatRejection:()=>({accepted:false,code:'heartbeat_rejected'})}:
 id==='@/lib/mux-duration-sync.mjs'?{syncMuxUpload:()=>{throw Error('Unexpected Mux sync')}}:
 id==='@/lib/admin-pages.mjs'?{collectPages:()=>{throw Error('Unexpected dashboard read')}}:
 id==='@/lib/error-registry.mjs'?{identifyError:()=>({status:503,errorId:'ADP-ADM-099'}),sanitizeApiError:(code)=>({error:code})}:require(id)
 function evaluate(path) {
  const source=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  const exports={}
  new Function('require','exports',source)(load,exports)
  return exports
 }
 return {exports:evaluate(file),calls}
}
const body={sessionId:'11111111-1111-4111-8111-111111111111',requestId:'22222222-2222-4222-8222-222222222222',expectedVersion:0,clientSequence:1,position:0,isPlaying:true,kind:'play'}
for(const flag of ['false','true'])test('actual routes fail closed with '+(flag==='false'?'application':'database readiness')+' gate',{concurrency:false},async()=>{
 const previous=process.env.PLAYBACK_HEARTBEATS_ENABLED
 process.env.PLAYBACK_HEARTBEATS_ENABLED=flag
 try{
  for(const [file,method] of [['src/app/api/videos/[id]/playback-token/route.ts','GET'],['src/app/api/videos/heartbeat/route.ts','POST'],['src/app/api/videos/[id]/session/route.ts','POST']]){
   const {exports,calls}=route(file,null)
   const response=await exports[method](new Request('http://localhost/api/admin?uploadId=fixture',{method, ...(method==='POST'?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})}),{params:Promise.resolve({id:body.sessionId})})
   assert.equal(response.status,503,file+' '+method)
   assert.deepEqual(calls,flag==='false'?[]:['adp_playback_integrity_version'])
  }
 }finally{if(previous===undefined)delete process.env.PLAYBACK_HEARTBEATS_ENABLED;else process.env.PLAYBACK_HEARTBEATS_ENABLED=previous}
})

test('admin metadata sync stays disabled independently of playback', async () => {
 const previous = process.env.MUX_METADATA_SYNC_ENABLED
 delete process.env.MUX_METADATA_SYNC_ENABLED
 try {
  const { exports, calls } = route('src/app/api/admin/route.ts', null)
  const response = await exports.POST(new Request('http://localhost/api/admin', {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ action: 'mux-sync', videoId: body.sessionId }),
  }))
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'metadata_sync_disabled')
  assert.deepEqual(calls, [])
 } finally {
  if (previous === undefined) delete process.env.MUX_METADATA_SYNC_ENABLED
  else process.env.MUX_METADATA_SYNC_ENABLED = previous
 }
})
