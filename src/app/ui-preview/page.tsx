import Image from 'next/image'
import { notFound } from 'next/navigation'
import logo from './adp-logo.png'
import styles from './preview.module.css'

export const dynamic = 'force-dynamic'

const lessons = [
  { title: 'Social Engineering', minutes: 12, progress: 100 },
  { title: 'HUMINT and SOP', minutes: 18, progress: 45 },
  { title: 'Field Simulation', minutes: 24, progress: 0 },
]

export default function UiPreview() {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.ADP_UI_PREVIEW !== 'true') notFound()

  return <main className={`shell ${styles.preview}`}>
    <header className="topbar">
      <span className={styles.brand}>
        <Image src={logo} alt="" width={48} className={styles.logo} unoptimized />
        <span>Analytics Development Program</span>
      </span>
    </header>
    <section className="page">
      <h1 className={styles.heading}>Training Library</h1>
      <div className="grid">{lessons.map((lesson) => <article className="card" key={lesson.title}>
        <div className="thumb" aria-hidden="true" />
        <div className="card-body">
          <h2>{lesson.title}</h2>
          <div className="meta"><span>{lesson.minutes} min</span><span>{lesson.progress === 100 ? 'Complete' : lesson.progress ? 'In progress' : 'Not started'}</span></div>
          <div className="bar"><span style={{ width: `${lesson.progress}%` }}/></div>
          <small>{lesson.progress}%</small>
        </div>
      </article>)}</div>
    </section>
  </main>
}
