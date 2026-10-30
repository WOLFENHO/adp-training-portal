import Link from 'next/link'
import { requireMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { Header } from '@/components/shell'
import type { Video } from '@/lib/types'
import { thumbnailToken } from '@/lib/mux'
import { summarizeVideoProgress } from '@/lib/progress-status.mjs'

export const dynamic = 'force-dynamic'

export default async function Library() {
  const member = await requireMember()
  const [{ data: videos }, { data: rows }, { data: history }, { data: verified }] = await Promise.all([
    adminDb.from('videos').select('*').eq('published', true).order('sort_order'),
    adminDb.from('user_video_progress').select('video_id,verified_watched_seconds,completed_at').eq('user_id', member.id),
    adminDb.from('completion_records').select('video_id,completed_at,method').eq('user_id', member.id),
    adminDb.from('verified_completion_records').select('video_id,asset_id,duration_seconds,completed_at,validator_version').eq('user_id', member.id),
  ])
  const progress = new Map((rows ?? []).map((row: any) => [row.video_id, row]))
  const thumbnailTokens = new Map(await Promise.all((videos ?? []).filter((video) => video.playback_id)
    .map(async (video) => [video.id, await thumbnailToken(video.playback_id!, video.duration_seconds)] as const)))

  return <main className="shell"><Header member={member}/><section className="page">
    <div className="eyebrow">Member library</div><h1>Training library</h1>
    <p className="sub">Work through each lesson in order. Verified progress saves automatically.</p>
    {videos?.length ? <div className="grid">{(videos as Video[]).map((video) => {
      const p = progress.get(video.id) as any
      const summary = summarizeVideoProgress(video, p,
        (verified ?? []).filter((row) => row.video_id === video.id),
        (history ?? []).filter((row) => row.video_id === video.id))
      const thumb = video.thumbnail_url ?? (video.playback_id
        ? `https://image.mux.com/${video.playback_id}/thumbnail.jpg?token=${thumbnailTokens.get(video.id)}` : null)
      return <Link href={`/videos/${video.id}`} className="card" key={video.id}>
        {thumb ? <img className="thumb" src={thumb} alt=""/> : <div className="thumb" style={{display:'grid',placeItems:'center',color:'#aeb9be',letterSpacing:'.22em',fontSize:11}}>ADP · TRAINING</div>}
        <div className="card-body"><h2>{video.title}</h2><p>{video.description}</p>
          <div className="meta"><span>{Math.floor(video.duration_seconds / 60)} min</span>
            <span className={`status ${summary.status}`}>{summary.label}</span></div>
          {summary.historicalCompletedAt && !summary.currentVerified && <p className="historical-note">Historical completion retained; current verified coverage is shown below.</p>}
          <div className="bar"><span style={{width:`${summary.percent}%`}}/></div>
          <small>{summary.percent}% verified coverage</small>
        </div>
      </Link>
    })}</div> : <div className="empty">No training videos have been published yet.</div>}
  </section></main>
}

