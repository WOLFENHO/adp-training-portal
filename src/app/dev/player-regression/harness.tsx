'use client'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import MuxPlayer from '@mux/mux-player-react'
import { VideoPlayer } from '@/components/video-player'
const wait = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms))
let media:any
const FakeMedia = forwardRef(function FakeMedia(_props:any,ref:any) {
 const adapter=useMemo(()=>Object.assign(new EventTarget(),{currentTime:0,paused:true,seeking:false,readyState:4,volume:1,muted:false,
  pause(this:any){this.paused=true;this.dispatchEvent(new Event('pause'))},
  async play(this:any){this.paused=false;setTimeout(()=>this.dispatchEvent(new Event('playing')),0)},
 }),[])
 media=adapter
 useImperativeHandle(ref,()=>adapter,[adapter])
 return <div>Isolated media adapter (no Mux connection)</div>
}) as unknown as typeof MuxPlayer
export default function Harness(){
 const [mounted,setMounted]=useState(false),[report,setReport]=useState('Ready to run'),[epoch,setEpoch]=useState(0)
 const [kind,setKind]=useState<'pause'|'buffering'>('pause')
 useEffect(()=>{
 let cancelled=false
 let version=0,highwater=0,serverPlaying=false,release:(()=>void)|undefined
 let stoppedRequestId:string|undefined
 const simulateLostResponse=new URLSearchParams(window.location.search).has('lostResponse')
 const requests:any[]=[]; const previous=window.fetch
 window.fetch=async(input,init)=>{
  if(String(input).endsWith('/session'))return Response.json({sessionId:'11111111-1111-4111-8111-111111111111',position:0,version:0,lastEventSequence:0,durationVerified:true})
  if(String(input)!=='/api/videos/heartbeat')throw new Error('Harness blocked unexpected network request')
  const body=JSON.parse(String(init?.body));requests.push(body)
  if(body.kind===kind&&!release){
   stoppedRequestId=body.requestId
   await new Promise<void>(resolve=>{release=resolve})
   highwater=body.clientSequence
   if(simulateLostResponse)throw new TypeError('Injected lost stop response')
   return Response.json({accepted:false,code:'playback_budget_exceeded',version,lastEventSequence:highwater,acceptedPosition:0,serverIsPlaying:serverPlaying},{status:409})
  }
  if(body.requestId===stoppedRequestId)return Response.json({accepted:false,code:'playback_budget_exceeded',version,lastEventSequence:highwater,acceptedPosition:0,serverIsPlaying:serverPlaying},{status:409})
  if(body.expectedVersion!==version||body.clientSequence<=highwater)throw new Error('Invalid queue ordering')
  highwater=body.clientSequence;version++;serverPlaying=body.isPlaying
  return Response.json({accepted:true,version,lastEventSequence:highwater,acceptedPosition:0,serverIsPlaying:serverPlaying,percent:0,intervals:[],complete:false})
 }
 setMounted(true)
 const run=async()=>{try{
  for(let n=0;!media||!document.querySelector('.adp-player');n++){if(n>100)throw Error('Player did not mount');await wait(20)}
  await wait(100);if(cancelled)return;await media.play();await wait(100);if(cancelled)return
  if(!serverPlaying)throw Error('Initial active transition not accepted')
  if(kind==='pause')media.pause();else media.dispatchEvent(new Event('waiting'))
  for(let n=0;!release;n++){if(n>100)throw Error('Stop request not sent');await wait(10)}
  await media.play();await wait(30);release!();await wait(200)
  const stops=requests.filter(r=>r.kind==='pause'||r.kind==='buffering')
  if(new Set(stops.map(r=>r.requestId)).size!==1)throw Error('Stale recovery stop submitted: '+JSON.stringify(requests))
  if(!serverPlaying||media.paused)throw Error('Client/server did not converge on playing')
  setReport('PASS '+kind+' — '+JSON.stringify(requests.map(r=>({kind:r.kind,sequence:r.clientSequence,version:r.expectedVersion}))))
 }catch(error){setReport('FAIL '+String(error))}}
 void run()
 return()=>{cancelled=true;window.fetch=previous;media=null}
 },[epoch,kind])
 return <main><h1>React player queue regression</h1><p>Actual VideoPlayer and queue; synthetic media and HTTP transport. No database or Mux verification.</p>
 <button onClick={()=>{setMounted(false);setEpoch(e=>e+1)}}>Rerun</button>
 <button onClick={()=>{setMounted(false);setKind(k=>k==='pause'?'buffering':'pause')}}>Switch pause/buffering</button>
 <pre data-testid="result">{report}</pre>
 {mounted&&<VideoPlayer key={epoch+kind} videoId="11111111-1111-4111-8111-111111111111" playbackId="local-fixture" token="fixture" duration={100} initialIntervals={[]} complete={false} durationVerified mediaComponent={FakeMedia}/>}
 </main>
}
