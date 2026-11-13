/** Bound a transport attempt; a timeout remains an unknown server outcome. */
export async function fetchWithDeadline(fetcher, url, options, milliseconds = 10000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), milliseconds)
  try {
    return await fetcher(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

/** Retry the exact request/sequence after an unknown transport outcome. */
export function createReceiptRetry({ attempt, schedule = setTimeout, cancel = clearTimeout }) {
  let pending = null
  let timer = null
  let running = false
  let disposed = false
  let failures = 0
  function arm() {
    if (disposed || !pending || timer !== null) return
    timer = schedule(() => { timer = null; void retryNow() }, Math.min(10000, 1500 * 2 ** Math.min(failures, 3)))
  }
  async function retryNow() {
    if (disposed || running || !pending) return
    if (timer !== null) { cancel(timer); timer = null }
    const item = pending
    running = true
    let outcome = 'network-error'
    try { outcome = await attempt(item) } catch { /* Unknown outcome; retain the same request. */ }
    running = false
    if (disposed || pending !== item) return
    if (outcome === 'network-error') { failures++; arm() }
    else { pending = null; failures = 0 }
  }
  return {
    remember(item) { if (disposed) return; pending = item; failures = 0; arm() },
    resolve(item) { if (pending === item) { pending = null; failures = 0; if (timer !== null) { cancel(timer); timer = null } } },
    retryNow,
    hasPending: () => pending !== null,
    dispose() { disposed = true; pending = null; if (timer !== null) { cancel(timer); timer = null } },
  }
}

/** Later intents wait until the outcome of an earlier receipt is known. */
export function createReceiptBarrier() {
  let pending = null
  let release = null
  let waitPromise = null
  let disposed = false
  return {
    hold(item) {
      if (disposed || pending) return
      pending = item
      waitPromise = new Promise(resolve => { release = resolve })
    },
    wait() { return disposed ? Promise.resolve(false) : waitPromise ?? Promise.resolve(true) },
    settle(item) {
      if (pending !== item) return
      pending = null
      waitPromise = null
      const finish = release
      release = null
      finish?.(true)
    },
    dispose() {
      disposed = true
      pending = null
      waitPromise = null
      const finish = release
      release = null
      finish?.(false)
    },
  }
}
