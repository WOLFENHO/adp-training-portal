import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
function route(file,ready){
 const calls=[]
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
 const exports={}
 const forbidden=new Proxy({}, {get(){throw Error('Unexpected privileged mutation during maintenance')}})
 const load=id=>id==='@/lib/auth'?{getMember:async()=>({id:'11111111-1111-4111-8111-111111111111',is_admin:true})}:
 id==='@/lib/supabase/server'?{createClient:async()=>({rpc:async(name)=>{calls.push(name);return {data:ready,error:null}}})}:
 id==='@/lib/supabase/admin'?{adminDb:forbidden}:id==='@/lib/mux'?{mux:forbidden}:
 id==='@/lib/mux-duration-sync.mjs'?{syncMuxUpload:()=>{throw Error('Unexpected Mux sync')}}:require(id)
 new Function('require','exports',source)(load,exports)
 return {exports,calls}
}
const body={sessionId:'11111111-1111-4111-8111-111111111111',requestId:'22222222-2222-4222-8222-222222222222',expectedVersion:0,clientSequence:1,position:0,isPlaying:true,kind:'play'}
for(const flag of ['false','true'])test('actual routes fail closed with '+(flag==='false'?'application':'database readiness')+' gate',{concurrency:false},async()=>{
 const previous=process.env.PLAYBACK_HEARTBEATS_ENABLED
 process.env.PLAYBACK_HEARTBEATS_ENABLED=flag
 try{
  for(const [file,method] of [['src/app/api/admin/route.ts','GET'],['src/app/api/admin/route.ts','POST'],['src/app/api/videos/heartbeat/route.ts','POST'],['src/app/api/videos/[id]/session/route.ts','POST']]){
   const {exports,calls}=route(file,null)
   const response=await exports[method](new Request('http://localhost/api/admin?uploadId=fixture',{method, ...(method==='POST'?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})}),{params:Promise.resolve({id:body.sessionId})})
   assert.equal(response.status,503,file+' '+method)
   assert.deepEqual(calls,flag==='false'?[]:['adp_playback_integrity_version'])
  }
 }finally{if(previous===undefined)delete process.env.PLAYBACK_HEARTBEATS_ENABLED;else process.env.PLAYBACK_HEARTBEATS_ENABLED=previous}
})
