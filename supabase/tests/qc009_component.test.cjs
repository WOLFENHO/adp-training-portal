const test = require('node:test')
const assert = require('node:assert/strict')
const { componentHarness } = require('./player_component_harness.cjs')

function server({ lose = () => false, reject = () => null } = {}) {
  let version = 0, sequence = 0, playing = false, position = 0, complete = false
  const receipts = new Map()
  const transport = async body => {
    let response = receipts.get(body.requestId)
    if (response) return Response.json({ ...response, duplicate: true, currentVersion: version, currentLastEventSequence: sequence, currentServerIsPlaying: playing, currentAcceptedPosition: position, currentSessionActive: true })
    const denial = reject(body)
    if (denial) return Response.json({ accepted: false, code: denial, version, lastEventSequence: sequence, acceptedPosition: position, serverIsPlaying: playing }, { status: 409 })
    assert.equal(body.expectedVersion, version)
    assert.ok(body.clientSequence > sequence)
    sequence = body.clientSequence
    version++
    playing = body.isPlaying
    position = body.position
    if (body.kind === 'complete') complete = true
    response = { accepted: true, version, lastEventSequence: sequence, acceptedPosition: position, serverIsPlaying: playing, percent: complete ? 100 : 0, intervals: [], complete }
    receipts.set(body.requestId, response)
    if (lose(body)) throw new TypeError('lost response after server commit')
    return Response.json(response)
  }
  return { transport, get state() { return { version, sequence, playing, position, complete } } }
}

test('QC-009 component initializes one play heartbeat with mocked media and network', async () => {
  let version = 0
  const h = componentHarness({ transport: async body => Response.json({ accepted: true, version: ++version, acceptedPosition: body.position, serverIsPlaying: body.isPlaying, percent: 0, intervals: [], complete: false }) })
  try {
    await h.flush()
    h.clickPlay()
    await h.flush(50)
    assert.equal(h.requests.filter(r => r.kind === 'play').length, 1)
    assert.equal(h.media.plays, 2)
  } finally { h.dispose() }
})

test('QC-009 lost accepted heartbeat reconciles duplicate receipt before a newer pause', async () => {
  let lost = false
  const s = server({ lose: body => body.kind === 'play' && !lost && (lost = true) })
  const h = componentHarness({ transport: s.transport })
  try {
    await h.flush(); h.clickPlay(); await h.flush(30)
    h.clickPlay(); await h.flush(20)
    assert.equal(h.requests.length, 1)
    h.online(); await h.flush(50)
    assert.deepEqual(h.requests.slice(0, 2), [h.requests[0], h.requests[0]])
    assert.equal(h.requests[2].kind, 'pause')
    assert.equal(s.state.playing, false)
  } finally { h.dispose() }
})

test('QC-009 final completion retries the identical receipt and refreshes once', async () => {
  let lost = false
  const s = server({ lose: body => body.kind === 'complete' && !lost && (lost = true) })
  const h = componentHarness({ transport: s.transport })
  try {
    await h.flush(); h.clickPlay(); await h.flush(40)
    h.media.currentTime = 16.6517; h.media.paused = true; h.media.ended = true
    h.media.dispatchEvent(new Event('ended'))
    await h.flush(30)
    assert.equal(h.refreshes.length, 0)
    h.online(); await h.flush(50)
    const completions = h.requests.filter(r => r.kind === 'complete')
    assert.equal(completions.length, 2)
    assert.deepEqual(completions[0], completions[1])
    assert.equal(h.refreshes.length, 1)
    assert.equal(s.state.complete, true)
  } finally { h.dispose() }
})

test('QC-009 stale play rejection uses returned version on next intent', async () => {
  let stale = true
  const observed = []
  const h = componentHarness({ transport: async body => {
    observed.push(body)
    if (stale) { stale = false; return Response.json({ accepted: false, code: 'stale_version', version: 2, lastEventSequence: 1, acceptedPosition: 0, serverIsPlaying: false }, { status: 409 }) }
    return Response.json({ accepted: true, version: 3, lastEventSequence: body.clientSequence, acceptedPosition: 0, serverIsPlaying: true, percent: 0, intervals: [], complete: false })
  } })
  try {
    await h.flush(); h.clickPlay(); await h.flush(40)
    h.clickPlay(); await h.flush(40)
    assert.equal(observed[1].expectedVersion, 2)
    assert.ok(observed[1].clientSequence > observed[0].clientSequence)
  } finally { h.dispose() }
})

test('QC-009 session expiration stops media and cannot record completion', async () => {
  const h = componentHarness({ transport: async body => Response.json({ accepted: false, code: 'session_expired', version: 0, lastEventSequence: body.clientSequence, acceptedPosition: 0, serverIsPlaying: false }, { status: 409 }) })
  try {
    await h.flush(); h.clickPlay(); await h.flush(40)
    assert.equal(h.media.paused, true)
    assert.equal(h.media.plays, 1)
    assert.equal(h.refreshes.length, 0)
    assert.match(h.text(), /Playback session expired|Playback session ended/)
  } finally { h.dispose() }
})

test('QC-009 overlapping pause and play preserve order without duplicate initialization', async () => {
  let release
  const s = server()
  const h = componentHarness({ transport: body => body.kind === 'pause' ? new Promise(resolve => { release = () => s.transport(body).then(resolve) }) : s.transport(body) })
  try {
    await h.flush(); h.clickPlay(); await h.flush(40)
    h.media.pause(); await h.flush(10)
    assert.equal(typeof release, 'function')
    h.clickPlay(); await h.flush(10)
    assert.deepEqual(h.requests.map(r => r.kind), ['play', 'pause'])
    release(); await h.flush(60)
    assert.deepEqual(h.requests.map(r => r.kind), ['play', 'pause', 'play'])
    assert.equal(s.state.playing, true)
  } finally { h.dispose() }
})

test('QC-009 repeated lost receipts block newer intents and unmount cancels retry', async () => {
  const s = server()
  let failures = 0
  const h = componentHarness({ transport: async (body) => {
    const response = await s.transport(body)
    if (body.kind === 'play' && failures++ < 3) throw new TypeError('lost response')
    return response
  } })
  try {
    await h.flush(); h.clickPlay(); await h.flush(30); h.clickPlay()
    await h.flush(10)
    assert.equal(h.requests.length, 1)
    for (let n = 0; n < 2; n++) { h.online(); await h.flush(20); assert.equal(h.requests.filter(r => r.kind === 'pause').length, 0) }
    h.online(); await h.flush(50)
    assert.equal(h.requests.filter(r => r.kind === 'play').length, 4)
    assert.equal(h.requests.filter(r => r.kind === 'pause').length, 1)
    const before = h.requests.length
    h.dispose()
    await h.flush(20)
    assert.equal(h.requests.length, before)
  } finally { h.dispose() }
})

test('QC-009 mocked media rejects unwatched forward seek without a heartbeat', async () => {
  const s = server()
  const h = componentHarness({ transport: s.transport })
  try {
    await h.flush(); h.clickPlay(); await h.flush(40)
    const before = h.requests.length
    h.media.currentTime = 12
    h.media.seeking = true
    h.media.dispatchEvent(new Event('seeking'))
    h.media.seeking = false
    h.media.dispatchEvent(new Event('seeked'))
    await h.flush(20)
    assert.equal(h.media.currentTime, 0)
    assert.equal(h.requests.length, before)
    assert.equal(s.state.position, 0)
  } finally { h.dispose() }
})
