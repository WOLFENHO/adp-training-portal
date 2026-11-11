import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

const lessons = [
  { title: 'Social Engineering', description: 'Recognize common techniques and practice safer responses.', minutes: 12, progress: 100 },
  { title: 'HUMINT and SOP', description: 'Review collection procedures and operational standards.', minutes: 18, progress: 45 },
  { title: 'Field Simulation', description: 'Prepare for briefings, records review, and live engagement.', minutes: 24, progress: 0 },
]

export default function UiPreview() {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.ADP_UI_PREVIEW !== 'true') notFound()

  return <main className="shell">
    <header className="topbar"><span className="brand">ANALYTICS DEVELOPMENT PROGRAM<small>INTERNAL TRAINING PORTAL</small></span></header>
    <section className="page">
      <div className="eyebrow">UI Preview</div>
      <h1>Training library</h1>
      <p className="sub">Sample lessons and progress for layout review. Playback is disabled.</p>
      <div className="grid">{lessons.map((lesson) => <article className="card" key={lesson.title}>
        <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}>ADP · TRAINING</div>
        <div className="card-body">
          <h2>{lesson.title}</h2><p>{lesson.description}</p>
          <div className="meta"><span>{lesson.minutes} min</span><span>{lesson.progress === 100 ? 'Complete' : lesson.progress ? 'In progress' : 'Not started'}</span></div>
          <div className="bar"><span style={{ width: `${lesson.progress}%` }}/></div>
          <small>{lesson.progress}% sample progress</small>
        </div>
      </article>)}</div>
    </section>
  </main>
}
