'use client'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import MuxPlayer from '@mux/mux-player-react'
import { VideoPlayer } from '@/components/video-player'
const wait = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms))
let media:any
const FakeMedia = forwardRef(function FakeMedia(_props:any,ref:any) {
 const adapter=useMemo(()=>{
  const target=Object.assign(new EventTarget(),{time:0,seeks:0,plays:0,paused:true,seeking:false,ended:false,readyState:4,volume:1,muted:false,
   pause(this: EventTarget & { paused: boolean }){this.paused=true;this.dispatchEvent(new Event('pause'))},
   async play(this: EventTarget & { plays: number; paused: boolean }){this.plays++;this.paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('waiting'));this.dispatchEvent(new Event('playing'))},
  })
  return Object.defineProperty(target,'currentTime',{
   get:()=>target.time,
   set(value:number){target.seeks++;target.time=value;if(!target.paused)target.dispatchEvent(new Event('waiting'))},
  })
 },[])
 media=adapter
 useImperativeHandle(ref,()=>adapter,[adapter])
 return <div>Isolated media adapter (no Mux connection)</div>
}) as unknown as typeof MuxPlayer
export default function Harness(){
 const [mounted,setMounted]=useState(false),[report,setReport]=useState('Ready to run'),[epoch,setEpoch]=useState(0)
 const [duration,setDuration]=useState(100)
 const [kind,setKind]=useState<'pause'|'buffering'>('pause')
 useEffect(()=>{
 let cancelled=false
 setDuration(100)
 setReport("Running regression checks…")
 let sessionStarts=0,version=0,highwater=0,serverPlaying=false,release:(()=>void)|undefined
 let stoppedRequestId:string|undefined
 const simulateLostResponse=new URLSearchParams(window.location.search).has('lostResponse')
 const requests:any[]=[]; const previous=window.fetch
 window.fetch=async(input,init)=>{
  if(String(input).endsWith('/session')){
   sessionStarts++
   return Response.json({sessionId:'11111111-1111-4111-8111-111111111111',position:3,version:0,lastEventSequence:0,durationVerified:true})
  }
  if(String(input)!=='/api/videos/heartbeat')throw new Error('Harness blocked unexpected network request')
  const body=JSON.parse(String(init?.body));requests.push(body)
  if(body.kind===kind&&!release){
   stoppedRequestId=body.requestId
   await new Promise<void>(resolve=>{release=resolve})
   if(simulateLostResponse){
    highwater=body.clientSequence
    throw new TypeError('Injected lost stop response')
   }
  }
  if(simulateLostResponse&&body.requestId===stoppedRequestId)return Response.json({accepted:false,code:'playback_budget_exceeded',version,lastEventSequence:highwater,acceptedPosition:body.position,serverIsPlaying:serverPlaying},{status:409})
  if(body.expectedVersion!==version||body.clientSequence<=highwater)throw new Error('Invalid queue ordering')
  highwater=body.clientSequence;version++;serverPlaying=body.isPlaying
  return Response.json({accepted:true,version,lastEventSequence:highwater,acceptedPosition:body.position,serverIsPlaying:serverPlaying,percent:0,intervals:[],complete:false})
 }
 setMounted(true)
 const run=async()=>{try{
  for(let n=0;!media||!document.querySelector('.adp-player');n++){if(n>100)throw Error('Player did not mount');await wait(20)}
  await wait(100);if(cancelled)return
  if(media.currentTime!==3||media.seeks!==1||sessionStarts!==1)throw Error('Resume was not initialized once')
  await media.play()
  media.dispatchEvent(new Event('playing'))
  await wait(100);if(cancelled)return
  if(!serverPlaying||media.plays!==2||media.seeks!==1||requests.length!==1)throw Error('Initial play repeated or reset media')
  media.time=4
  media.dispatchEvent(new Event('timeupdate'))
  setDuration(101)
  await wait(100);if(cancelled)return
  media.dispatchEvent(new Event('loadedmetadata'))
  if(media.currentTime!==4||media.seeks!==1||requests.length!==1||sessionStarts!==1)throw Error('Effect rerun reset media or initialized playback again')
  if(kind==='pause')media.pause()
  else {
   media.dispatchEvent(new Event('waiting'))
   media.dispatchEvent(new Event('waiting'))
  }
  for(let n=0;!release;n++){if(n>100)throw Error('Stop request not sent');await wait(10)}
  if(kind==='pause')await media.play()
  else media.dispatchEvent(new Event('playing'))
  media.dispatchEvent(new Event('playing'))
  await wait(30);release!();await wait(200)
  const stops=requests.filter(r=>r.kind==='pause'||r.kind==='buffering')
  if(new Set(stops.map(r=>r.requestId)).size!==1)throw Error('Duplicate or stale stop submitted')
  if(requests.filter(r=>r.kind==='play').length!==2)throw Error('Duplicate play initialization')
  if(!serverPlaying||media.paused||media.currentTime!==(simulateLostResponse?3:4)||media.seeks!==(simulateLostResponse?2:1)||media.plays!==(kind==='pause'?4:3))throw Error('Recovery replayed, reset, or failed to converge')
  const beforeSeek = requests.length
  const allowedPosition = media.currentTime
  media.time = 80
  media.seeking = true
  media.dispatchEvent(new Event('timeupdate'))
  media.dispatchEvent(new Event('seeking'))
  media.seeking = false
  media.dispatchEvent(new Event('seeked'))
  await wait(30)
  if (media.currentTime !== allowedPosition || requests.length !== beforeSeek) throw Error('Rejected seek moved the clock or sent a heartbeat')
  media.time = 16.6517
  media.ended = true
  media.paused = true
  media.dispatchEvent(new Event('pause'))
  media.dispatchEvent(new Event('ended'))
  media.dispatchEvent(new Event('ended'))
  media.paused = false
  media.dispatchEvent(new Event('playing'))
  media.dispatchEvent(new Event('waiting'))
  await wait(100)
  const final = requests.slice(beforeSeek)
  if (final.length !== 1 || final[0].kind !== 'complete' || final[0].position !== 16.6517) throw Error('End-of-media events restarted playback or changed the reported position')
  setReport('PASS '+kind+' — '+JSON.stringify(requests.map(r=>({kind:r.kind,sequence:r.clientSequence,version:r.expectedVersion}))))
 }catch(error){setReport('FAIL '+String(error))}}
 void run()
 return()=>{cancelled=true;window.fetch=previous;media=null}
 },[epoch,kind])
 return <main><h1>React player queue regression</h1><p>Actual VideoPlayer and queue; synthetic media and HTTP transport. No database or Mux verification.</p>
 <button onClick={()=>{setMounted(false);setEpoch(e=>e+1)}}>Rerun</button>
 <button onClick={()=>{setMounted(false);setKind(k=>k==='pause'?'buffering':'pause')}}>Switch pause/buffering</button>
 <pre data-testid="result">{report}</pre>
 {mounted&&<VideoPlayer key={epoch+kind} videoId="11111111-1111-4111-8111-111111111111" playbackId="local-fixture" token="fixture" duration={duration} initialIntervals={[]} complete={false} durationVerified mediaComponent={FakeMedia}/>}
 </main>
}
