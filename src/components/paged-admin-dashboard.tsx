'use client'
import { useEffect, useRef, useState } from 'react'
import { transferExistingUpload } from '@/lib/upload-transfer.mjs'
import { adminDashboardMessage, adminMutationMessage } from '@/lib/maintenance-messages.mjs'

type View = 'profiles' | 'allowed' | 'videos' | 'progress' | 'historical' | 'verified'
type Page = { rows: any[]; nextCursor: string | null; cursor: string | null; previous: (string | null)[]; loading: boolean; error: string | null }
const blank = (): Page => ({ rows: [], nextCursor: null, cursor: null, previous: [], loading: false, error: null })
const names: View[] = ['profiles', 'allowed', 'videos', 'progress', 'historical', 'verified']

function CompletionRows({ rows }: { rows: any[] }) {
  return <div className="table-wrap"><table><thead><tr><th scope="col">Member</th><th scope="col">Video</th><th scope="col">Evidence</th><th scope="col">Recorded</th><th scope="col">Progress row</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.userId}-${row.videoId}-${index}`}><td>{row.username}</td><td>{row.title}</td><td>{row.status}</td><td>{row.completedAt ? new Date(row.completedAt).toLocaleString() : '—'}</td><td>{row.hasProgress ? 'Present' : 'No progress record'}</td></tr>)}</tbody></table></div>
}

export function PagedAdminDashboard() {
  const [tab, setTab] = useState<'users' | 'videos' | 'progress'>('users')
  const [pages, setPages] = useState<Record<View, Page>>(() => Object.fromEntries(names.map(name => [name, blank()])) as Record<View, Page>)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ uploadUrl: string; file: File; videoId: string } | null>(null)
  const generations = useRef<Record<View, number>>({ profiles: 0, allowed: 0, videos: 0, progress: 0, historical: 0, verified: 0 })

  async function load(view: View, cursor: string | null = null, previous: (string | null)[] = []) {
    const generation = ++generations.current[view]
    setPages(current => ({ ...current, [view]: { ...current[view], loading: true, error: null } }))
    const query = new URLSearchParams({ view, limit: ['progress', 'historical', 'verified'].includes(view) ? '20' : '50' })
    if (cursor) query.set('cursor', cursor)
    try {
      const response = await fetch(`/api/admin/page?${query}`, { cache: 'no-store' })
      const data: any = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(data.rows)) throw Error(adminDashboardMessage(data.error))
      if (generation === generations.current[view]) setPages(current => ({ ...current, [view]: { rows: data.rows, nextCursor: data.nextCursor ?? null, cursor, previous, loading: false, error: null } }))
    } catch (error) {
      if (generation === generations.current[view]) setPages(current => ({ ...current, [view]: { ...current[view], loading: false, error: error instanceof Error ? error.message : 'Page unavailable.' } }))
    }
  }
  useEffect(() => { void load('profiles'); void load('allowed') }, [])
  function select(next: typeof tab) { setTab(next); if (next === 'progress') { void load('progress'); void load('historical'); void load('verified') } else if (next === 'videos') void load('videos') }
  function controls(view: View) {
    const page = pages[view]
    return <><nav className="row" aria-label={`${view} pages`}>
      <button type="button" className="button secondary" disabled={page.loading || !page.previous.length} onClick={() => void load(view, page.previous.at(-1) ?? null, page.previous.slice(0, -1))}>Previous page</button>
      <button type="button" className="button secondary" disabled={page.loading || !page.nextCursor} onClick={() => void load(view, page.nextCursor, [...page.previous, page.cursor])}>Next page</button>
      <span className="sub" role="status" aria-live="polite">{page.loading ? 'Loading page…' : `${page.rows.length} records on this page`}</span>
    </nav>{page.error && <div role="alert" className="notice">{page.error} <button type="button" className="button secondary" onClick={() => void load(view, page.cursor, page.previous)}>Retry page</button></div>}</>
  }
  async function act(input: any, file?: File) {
    setBusy(true); setNotice('')
    try {
      const response = await fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      const data: any = await response.json().catch(() => ({}))
      if (!response.ok) throw Error(adminMutationMessage(input.action, data, response.status))
      if (data.uploadUrl) {
        if (!file) throw Error('Choose a video file first.')
        const target = { uploadUrl: data.uploadUrl as string, videoId: data.videoId as string, file }
        setPending(target); await transferExistingUpload(target); setPending(null)
      }
      setNotice(input.action === 'progress-complete' ? 'Historical completion recorded.' : 'Saved. Reloaded the affected page.')
      await Promise.all((input.action === 'access' ? ['allowed', 'profiles'] as View[] : input.action.startsWith('progress-') ? ['progress', 'historical', 'verified'] as View[] : ['videos'] as View[]).map(view => load(view)))
      return true
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Operation failed.'); return false }
    finally { setBusy(false) }
  }
  const canPublish = (video: any) => Boolean(video.playback_id && Number(video.duration_seconds) > 0 && video.duration_precision_verified)
  return <>
    <div className="admin-nav" role="group" aria-label="Administration sections">{(['users', 'videos', 'progress'] as const).map(name => <button type="button" className={`button ${tab === name ? '' : 'secondary'}`} aria-pressed={tab === name} key={name} onClick={() => select(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
    {notice && <div className="notice" role="status" aria-live="polite">{notice}</div>}
    {tab === 'users' && <>
      <div className="panel"><h2>Add authorized Discord ID</h2><form className="row" onSubmit={event => { event.preventDefault(); const form = event.currentTarget, discordId = String(new FormData(form).get('discordId') ?? '').trim(); void act({ action: 'access', discordId, enabled: true }).then(saved => { if (saved) form.reset() }) }}><input name="discordId" className="field" aria-label="Discord user ID" placeholder="Discord user ID" inputMode="numeric" pattern="[0-9]{5,25}" required /><button className="button" disabled={busy}>Add to whitelist</button></form></div>
      <div className="panel"><h2>Whitelisted Discord IDs</h2>{controls('allowed')}{!pages.allowed.rows.length && !pages.allowed.loading && !pages.allowed.error ? <p className="sub">No entries on this page.</p> : <div className="table-wrap"><table><thead><tr><th scope="col">Discord ID</th><th scope="col">Added</th><th scope="col">Action</th></tr></thead><tbody>{pages.allowed.rows.map(row => <tr key={row.discord_id}><td>{row.discord_id}</td><td>{row.added_at ? new Date(row.added_at).toLocaleString() : '—'}</td><td><button type="button" className="button danger" disabled={busy} onClick={() => void act({ action: 'access', discordId: row.discord_id, enabled: false })}>Remove</button></td></tr>)}</tbody></table></div>}</div>
      <div className="panel"><h2>Registered members</h2>{controls('profiles')}{!pages.profiles.rows.length && !pages.profiles.loading && !pages.profiles.error ? <p className="sub">No members on this page.</p> : <div className="table-wrap"><table><thead><tr><th scope="col">Member</th><th scope="col">Discord ID</th><th scope="col">Last activity</th><th scope="col">Access</th><th scope="col">Action</th></tr></thead><tbody>{pages.profiles.rows.map(row => <tr key={row.id}><td>{row.username}</td><td>{row.discord_id}</td><td>{row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : '—'}</td><td>{row.isAuthorized ? 'Authorized' : 'Denied'}</td><td>{row.isAuthorized && <button type="button" className="button danger" disabled={busy} onClick={() => void act({ action: 'access', discordId: row.discord_id, enabled: false })}>Remove</button>}</td></tr>)}</tbody></table></div>}</div>
    </>}
    {tab === 'videos' && <>
      <div className="panel"><h2>Upload a training video</h2>{pending && <div className="notice" role="status">The existing upload target is pending. <button type="button" className="button secondary" disabled={busy} onClick={() => { setBusy(true); void transferExistingUpload(pending).then(() => { setPending(null); setNotice('Upload received.'); void load('videos') }).catch(error => setNotice(error instanceof Error ? error.message : 'Transfer failed.')).finally(() => setBusy(false)) }}>Retry file transfer</button></div>}
        <form className="form-grid" onSubmit={event => { event.preventDefault(); const form = event.currentTarget, values = new FormData(form), file = form.querySelector<HTMLInputElement>('#video-file')?.files?.[0]; if (!file) { setNotice('Choose a video file.'); return } void act({ action: 'video-create', title: values.get('title'), description: values.get('description') }, file).then(saved => { if (saved) form.reset() }) }}><input name="title" className="field" aria-label="Video title" placeholder="Video title" required /><input type="file" id="video-file" className="field" aria-label="Video file" accept="video/*" required /><textarea name="description" className="field" aria-label="Video description" placeholder="Description" /><button className="button" disabled={busy || Boolean(pending)}>Upload to Mux</button></form></div>
      {controls('videos')}{!pages.videos.rows.length && !pages.videos.loading && !pages.videos.error && <p className="sub">No videos on this page.</p>}
      {pages.videos.rows.map(video => <form key={video.id} className="panel form-grid" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void act({ action: 'video-update', videoId: video.id, title: values.get('title'), description: values.get('description'), thumbnailUrl: values.get('thumbnailUrl') || null, published: values.get('published') === 'on', sortOrder: Number(values.get('sortOrder')) }) }}><input name="title" className="field" aria-label={`Title for ${video.title}`} defaultValue={video.title} required /><input name="sortOrder" className="field" aria-label={`Sort order for ${video.title}`} type="number" defaultValue={video.sort_order} /><textarea name="description" className="field" aria-label={`Description for ${video.title}`} defaultValue={video.description} /><input name="thumbnailUrl" className="field" aria-label={`Thumbnail URL for ${video.title}`} defaultValue={video.thumbnail_url || ''} /><label className="row"><input name="published" type="checkbox" defaultChecked={video.published} disabled={!canPublish(video) && !video.published} /> Published · {canPublish(video) ? 'Mux metadata verified' : 'Mux metadata pending verification'}</label><div className="row"><button className="button" disabled={busy}>Save video</button>{video.mux_upload_id && !video.duration_precision_verified && <button type="button" className="button secondary" disabled={busy} onClick={() => confirm('Synchronize this video’s Mux metadata and reconcile progress?') && void act({ action: 'mux-sync', videoId: video.id })}>Sync Mux metadata</button>}<span className="sub">Unpublish to remove from the library while retaining training history.</span></div></form>)}
    </>}
    {tab === 'progress' && <div className="panel"><h2>Recorded progress</h2><p className="sub">Only saved progress records appear. Verified and historical completions are separate.</p>{controls('progress')}{!pages.progress.rows.length && !pages.progress.loading && !pages.progress.error ? <p className="sub">No progress records on this page.</p> : <div className="table-wrap"><table><thead><tr><th scope="col">Member</th><th scope="col">Video</th><th scope="col">Status</th><th scope="col">Verified coverage</th><th scope="col">Verified completion</th><th scope="col">Historical completion</th><th scope="col">Actions</th></tr></thead><tbody>{pages.progress.rows.map(row => <tr key={`${row.userId}-${row.videoId}`}><td>{row.username}</td><td>{row.title}</td><td>{row.label}</td><td>{Math.floor(row.verifiedWatchedSeconds)} / {row.durationSeconds}s ({row.percent}%)</td><td>{row.verifiedCompletedAt ? new Date(row.verifiedCompletedAt).toLocaleString() : '—'}</td><td>{row.historicalCompletedAt ? new Date(row.historicalCompletedAt).toLocaleString() : '—'}</td><td className="row">{!row.hasHistoricalRecord && row.status !== 'verified_completed' && <button type="button" className="button secondary" disabled={busy} onClick={() => void act({ action: 'progress-complete', userId: row.userId, videoId: row.videoId })}>Mark historical</button>}<button type="button" className="button danger" disabled={busy} onClick={() => void act({ action: 'progress-reset', userId: row.userId, videoId: row.videoId })}>Reset</button></td></tr>)}</tbody></table></div>}</div>}
    {tab === 'progress' && <>
      <div className="panel"><h2>Historical completion records</h2>{controls('historical')}{!pages.historical.rows.length && !pages.historical.loading && !pages.historical.error ? <p className="sub">No historical completion records on this page.</p> : <CompletionRows rows={pages.historical.rows} />}</div>
      <div className="panel"><h2>Verified completion evidence</h2>{controls('verified')}{!pages.verified.rows.length && !pages.verified.loading && !pages.verified.error ? <p className="sub">No verified completion records on this page.</p> : <CompletionRows rows={pages.verified.rows} />}</div>
    </>}
  </>
}
