import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { Header } from '@/components/shell'
import { VideoPlayer } from '@/components/video-player'
import { playbackToken } from '@/lib/mux'
import { summarizeVideoProgress } from '@/lib/progress-status.mjs'

export const dynamic = 'force-dynamic'

export default async function Watch({params}:{params:Promise<{id:string}>}) {
  const { id } = await params
  const member = await requireMember()
  const { data: video } = await adminDb.from('videos').select('*').eq('id',id).eq('published',true).maybeSingle()
  if (!video) notFound()
  const [{ data: progress }, { data: intervals }, { data: history }, { data: verified }] = await Promise.all([
    adminDb.from('user_video_progress').select('verified_watched_seconds,completed_at').eq('video_id',id).eq('user_id',member.id).maybeSingle(),
    adminDb.from('watched_intervals').select('start_seconds,end_seconds,verification_source,completion_eligible,completion_end_seconds').eq('video_id',id).eq('user_id',member.id).eq('verification_source','release_1_2').is('reset_at',null).eq('asset_identity',`${video.asset_id}:${Number(video.duration_seconds).toFixed(3)}:12`),
    adminDb.from('completion_records').select('completed_at,method').eq('video_id',id).eq('user_id',member.id),
    adminDb.from('verified_completion_records').select('asset_id,duration_seconds,completed_at,validator_version,asset_identity,reset_at,verified_at').eq('video_id',id).eq('user_id',member.id),
  ])
  const visibleIntervals = (intervals ?? [])
    .filter((row) => !video.duration_precision_verified || row.completion_eligible)
    .map((row) => ({start_seconds:row.start_seconds,end_seconds:video.duration_precision_verified?row.completion_end_seconds:row.end_seconds}))
    .filter((row) => row.end_seconds !== null)
  const token = video.playback_id ? await playbackToken(video.playback_id,video.duration_seconds) : undefined
  const summary = summarizeVideoProgress(video,progress,verified ?? [],history ?? [])
  return <main className="shell"><Header member={member}/><section className="page">
    <Link href="/library" className="eyebrow">← Return to library</Link>
    <h1>{video.title}</h1><p className="sub">{video.description}</p>
    {summary.status==='historical_completed'&&<div className="notice">A historical completion is on record. It is not verified coverage of this video version.</div>}
    <VideoPlayer videoId={id} playbackId={video.playback_id} token={token} duration={video.duration_seconds}
      initialIntervals={visibleIntervals} complete={summary.currentVerified} durationVerified={Boolean(video.duration_precision_verified)}/>
    <div className="stat-row"><span>Verified coverage<strong>{summary.percent}%</strong></span>
      <span>Status<strong>{summary.label}</strong></span>
      <span>Duration<strong>{Math.floor(video.duration_seconds/60)} min</strong></span></div>
    {summary.historicalCompletedAt&&<p className="historical-note">Historical completion date: {new Date(summary.historicalCompletedAt).toLocaleString()}</p>}
    <div className="bar" style={{marginTop:14,height:6}}><span style={{width:`${summary.percent}%`}}/></div>
  </section></main>
}

