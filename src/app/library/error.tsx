'use client'

export default function LibraryError({ reset }: { reset: () => void }) {
  return <main className="shell"><section className="page" role="alert"><h1>TRAINING LIBRARY UNAVAILABLE</h1><p>Training data could not be loaded. No progress was changed.</p><button className="button" onClick={reset}>Try again</button></section></main>
}
