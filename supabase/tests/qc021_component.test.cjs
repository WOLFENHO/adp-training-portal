const test = require('node:test')
const assert = require('node:assert/strict')
const { componentHarness } = require('./player_component_harness.cjs')

test('QC-021 focused keyboard controls stay visible through auto-hide timer', async () => {
  let version = 0
  const h = componentHarness({ transport: async body => Response.json({ accepted: true, version: ++version, acceptedPosition: body.position, serverIsPlaying: body.isPlaying, percent: 0, intervals: [], complete: false }) })
  try {
    await h.flush(); h.clickPlay(); await h.flush(30)
    h.frame().props.onFocusCapture()
    await h.flush(3100)
    assert.equal(h.controls().props['aria-hidden'], false)
    assert.equal(h.controls().props.inert, false)
    const timeline = JSON.stringify(h.controls().props.children, (_key, value) => typeof value === 'function' ? undefined : value)
    assert.match(timeline, /aria-valuetext/)
  } finally { h.dispose() }
})
