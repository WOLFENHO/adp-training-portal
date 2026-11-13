const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const localRequire = createRequire(process.cwd() + '/package.json')
const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

function loadComponent(hooks, router) {
  const source = ts.transpileModule(fs.readFileSync('src/components/video-player.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  const mocks = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    '@mux/mux-player-react': { default: function MockMux() {} },
    'next/navigation': { useRouter: () => router },
    '@/lib/heartbeat-response.mjs': localRequire('./src/lib/heartbeat-response.mjs'),
    '@/lib/player-lifecycle.mjs': localRequire('./src/lib/player-lifecycle.mjs'),
    '@/lib/maintenance-messages.mjs': localRequire('./src/lib/maintenance-messages.mjs'),
    '@/lib/playback-recovery.mjs': localRequire('./src/lib/playback-recovery.mjs'),
    '@/lib/player-display.mjs': localRequire('./src/lib/player-display.mjs'),
  }
  new Function('require', 'exports', source)((id) => mocks[id] ?? localRequire(id), exports)
  return exports.VideoPlayer
}

function mediaAdapter() {
  const media = Object.assign(new EventTarget(), {
    currentTime: 0, paused: true, seeking: false, ended: false, readyState: 4, plays: 0, pauses: 0,
    async play() {
      this.plays++
      this.paused = false
      this.dispatchEvent(new Event('play'))
      this.dispatchEvent(new Event('playing'))
    },
    pause() {
      this.pauses++
      this.paused = true
      this.dispatchEvent(new Event('pause'))
    },
  })
  return media
}

function componentHarness({ transport, initialPosition = 0, duration = 16.7 }) {
  const oldFetch = global.fetch, oldWindow = global.window, oldDocument = global.document
  const media = mediaAdapter(), requests = [], refreshes = []
  const listeners = new Map()
  global.window = { addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) }
  global.document = { addEventListener() {}, removeEventListener() {}, fullscreenElement: null }
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/session')) return Response.json({ sessionId: '11111111-1111-4111-8111-111111111111', position: initialPosition, version: 0, lastEventSequence: 0, durationVerified: true })
    if (String(url) !== '/api/videos/heartbeat') throw new Error('unexpected network request')
    const body = JSON.parse(options.body)
    requests.push(structuredClone(body))
    return transport(body, options)
  }
  let cells = [], cursor = 0, effects = [], tree, scheduled = false, disposed = false
  const schedule = () => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; render() })
  }
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const hooks = {
    useRef(value) { const i = cursor++; return (cells[i] ??= { current: value }) },
    useState(initial) {
      const i = cursor++
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial
      return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; schedule() }]
    },
    useMemo(fn, deps) {
      const i = cursor++
      if (!cells[i] || !sameDeps(cells[i].deps, deps)) cells[i] = { value: fn(), deps }
      return cells[i].value
    },
    useCallback(fn, deps) {
      const i = cursor++
      if (!cells[i] || !sameDeps(cells[i].deps, deps)) cells[i] = { value: fn, deps }
      return cells[i].value
    },
    useEffect(fn, deps) {
      const i = cursor++
      if (!cells[i] || !sameDeps(cells[i].deps, deps)) effects.push({ i, fn, deps })
    },
  }
  const VideoPlayer = loadComponent(hooks, { refresh: () => refreshes.push(true) })
  const props = { videoId: '22222222-2222-4222-8222-222222222222', playbackId: 'playback', token: 'fixture', duration, initialIntervals: [], complete: false, durationVerified: true, mediaComponent: function FakeMedia() {} }
  const walk = (node, match) => {
    if (!node || typeof node !== 'object') return null
    if (match(node)) return node
    for (const child of [node.props?.children].flat(Infinity)) { const found = walk(child, match); if (found) return found }
    return null
  }
  function render() {
    if (disposed) return
    cursor = 0; effects = []
    tree = VideoPlayer(props)
    const player = walk(tree, node => node.type === props.mediaComponent)
    if (player) player.props.ref.current = media
    for (const { i, fn, deps } of effects) {
      cells[i]?.cleanup?.()
      cells[i] = { deps, cleanup: fn() }
    }
  }
  render()
  return {
    media, requests, refreshes,
    async flush(ms = 15) { await wait(ms); await wait(0) },
    clickPlay() { const button = walk(tree, node => node.props?.['aria-label'] === 'Play video' || node.props?.['aria-label'] === 'Pause video'); button.props.onClick() },
    text() { return JSON.stringify(tree, (key, value) => key === 'ref' ? undefined : typeof value === 'function' ? undefined : value) },
    online() { listeners.get('online')?.() },
    dispose() { if (disposed) return; disposed = true; for (const value of cells) value?.cleanup?.(); global.fetch = oldFetch; global.window = oldWindow; global.document = oldDocument },
  }
}

module.exports = { componentHarness, wait }
