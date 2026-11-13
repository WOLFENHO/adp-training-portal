'use client'

export default function WatchError({ reset }: { reset: () => void }) {
  return <main className="shell"><section className="page" role="alert"><h1>VIDEO UNAVAILABLE</h1><p>Playback data could not be loaded. Your saved progress is still on the server.</p><button className="button" onClick={reset}>Try again</button></section></main>
}
