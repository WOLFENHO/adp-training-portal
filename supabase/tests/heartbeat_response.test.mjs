import test from 'node:test'
import assert from 'node:assert/strict'
import { readHeartbeatResponse } from '../../src/lib/heartbeat-response.mjs'
test('large server receipts parse completely without retaining raw diagnostic response', async()=>{
 const intervals=Array.from({length:200},(_,i)=>({start_seconds:i,end_seconds:i+1}))
 const body={accepted:true,version:200,intervals,percent:90}
 const parsed=await readHeartbeatResponse(Response.json(body))
 assert.equal(Object.hasOwn(parsed,'rawBody'),false)
 assert.deepEqual(parsed.data,body)
})
test('unparseable success is an unknown outcome and must reach transport retry handling',async()=>{
 await assert.rejects(readHeartbeatResponse(new Response('<html>gateway error</html>')),SyntaxError)
})
