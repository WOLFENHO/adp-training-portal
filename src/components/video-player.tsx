'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import MuxPlayer from '@mux/mux-player-react'
import { readHeartbeatResponse } from '@/lib/heartbeat-response.mjs'
import { bindPauseBufferEvents, requiresServerPlayActivation, transitionRecoveryKind } from '@/lib/player-lifecycle.mjs'

type HeartbeatKind = 'play' | 'pause' | 'buffering' | 'periodic' | 'seek' | 'complete'
type Heartbeat = {
  requestId: string
  intentGeneration: number
  clientSequence: number
  position: number
  isPlaying: boolean
  kind: HeartbeatKind
  expectedVersion?: number
  scheduledAt: string
}
type Interval = { start_seconds: number; end_seconds: number }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function initialCoverage(rows: Interval[], duration: number) {
  const sorted = [...rows].sort((a, b) => a.start_seconds - b.start_seconds)
  let start: number | null = null
  let end = 0
  let total = 0
  for (const interval of sorted) {
    if (start === null) {
      start = interval.start_seconds
      end = interval.end_seconds
    } else if (interval.start_seconds <= end) {
      end = Math.max(end, interval.end_seconds)
    } else {
      total += end - start
      start = interval.start_seconds
      end = interval.end_seconds
    }
  }
  if (start !== null) total += end - start
  return duration ? Math.min(100, Math.floor((total / duration) * 100)) : 0
}

export function VideoPlayer({
  videoId,
  playbackId,
  token,
  duration,
  initialIntervals,
  complete,
  durationVerified,
  mediaComponent: MediaPlayer = MuxPlayer,
}: {
  videoId: string
  playbackId: string | null
  token?: string
  duration: number
  initialIntervals: Interval[]
  complete: boolean
  durationVerified: boolean
  /** Local integration harness may inject a media adapter; production uses Mux. */
  mediaComponent?: typeof MuxPlayer
}) {
  const ref = useRef<any>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const session = useRef<string | null>(null)
  const sessionVersion = useRef(0)
  const resumeAt = useRef(0)
  const lastHeartbeat = useRef(0)
  const periodicPending = useRef(false)
  const pendingRequest = useRef<Heartbeat | null>(null)
  const intervals = useRef(initialIntervals)
  const lastPosition = useRef(0)
  const seekBack = useRef<number | null>(null)
  const heartbeatQueue = useRef<Promise<void>>(Promise.resolve())
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackActive = useRef(false)
  const serverPlaying = useRef(false)
  const pausePending = useRef(false)
  const pauseRecoveryAttempted = useRef(false)
  const activatingPlayback = useRef(false)
  const activationRequestId = useRef<string | null>(null)
  const suppressPauseEvent = useRef(false)
  const confirmedPosition = useRef(0)
  const requestSequence = useRef(0)

  const [position, setPosition] = useState(0)
  const [confirmed, setConfirmed] = useState(() => initialCoverage(initialIntervals, duration))
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [message, setMessage] = useState('Preparing secure playback…')
  const [ready, setReady] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)

  const isCovered = (time: number) =>
    intervals.current.some((interval) => time >= interval.start_seconds && time <= interval.end_seconds)
  const isForwardPathCovered = (from: number, to: number) => {
    if (to <= from) return true
    let cursor = from
    for (const interval of [...intervals.current].sort((a, b) => a.start_seconds - b.start_seconds)) {
      if (interval.end_seconds < cursor) continue
      if (interval.start_seconds > cursor) return false
      cursor = Math.max(cursor, interval.end_seconds)
      if (cursor >= to) return true
    }
    return false
  }

  useEffect(() => {
    let alive = true
    fetch(`/api/videos/${videoId}/session`, { method: 'POST' })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!alive) return
        if (!response.ok || !data.sessionId) {
          setMessage(data.error || 'Playback could not be started.')
          setBuffering(false)
          return
        }
        session.current = data.sessionId
        sessionVersion.current = data.version ?? 0
        requestSequence.current = data.lastEventSequence ?? 0
        resumeAt.current = data.position
        confirmedPosition.current = data.position
        serverPlaying.current = false
        lastHeartbeat.current = Date.now()
        setReady(true)
        setMessage((data.durationVerified ?? durationVerified) ? 'Progress saves automatically.' : 'Legacy duration is unverified. Playback remains available, but verified completion is disabled until Mux metadata is synchronized.')
      })
      .catch(() => {
        setMessage('Playback session unavailable.')
        setBuffering(false)
      })
    return () => {
      alive = false
    }
  }, [videoId])

  const intentGeneration = useRef(0)
  const save = useCallback((pos: number, isPlaying: boolean, kind: HeartbeatKind) => {
    if (kind === 'play' || kind === 'pause' || kind === 'buffering') intentGeneration.current++
    const generation = intentGeneration.current
    const scheduledAt = new Date().toISOString()
    const request: Heartbeat = {
      intentGeneration: generation,
      requestId: crypto.randomUUID(),
      clientSequence: ++requestSequence.current,
      position: pos,
      isPlaying,
      kind,
      scheduledAt,
    }
    if (kind === 'periodic') periodicPending.current = true
    if ((kind === 'pause' || kind === 'buffering') && !isPlaying) pausePending.current = true
    console.info('[ADP playback] heartbeat scheduled', {
      requestId: request.requestId,
      clientSequence: request.clientSequence,
      kind,
      scheduledAt,
      requestedPosition: pos,
      isPlaying,
      mediaTime: ref.current?.currentTime,
      paused: ref.current?.paused,
      playbackActive: playbackActive.current,
    })

    heartbeatQueue.current = heartbeatQueue.current.then(async () => {
      if (!session.current) {
        if (kind === 'periodic') periodicPending.current = false
        return
      }

      const send = async (item: Heartbeat): Promise<'accepted' | 'rejected' | 'network-error'> => {
        if (item.kind === 'play' && activatingPlayback.current && activationRequestId.current === item.requestId) {
          // The initial playing event may fire after media time has advanced.
          // Start the server-active window at the last confirmed position, then
          // seek back and resume only after that transition is accepted.
          item.position = confirmedPosition.current
        }
        item.expectedVersion ??= sessionVersion.current
        const sentAt = new Date().toISOString()
        console.info('[ADP playback] heartbeat sent', {
          requestId: item.requestId,
          clientSequence: item.clientSequence,
          expectedVersion: item.expectedVersion,
          kind: item.kind,
          scheduledAt: item.scheduledAt,
          sentAt,
          requestedPosition: item.position,
          isPlaying: item.isPlaying,
          mediaTime: ref.current?.currentTime,
          paused: ref.current?.paused,
        })
        try {
          const response = await fetch('/api/videos/heartbeat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId: session.current,
              requestId: item.requestId,
              expectedVersion: item.expectedVersion,
              clientSequence: item.clientSequence,
              position: item.position,
              isPlaying: item.isPlaying,
              kind: item.kind,
            }),
          })
          const { contentType, rawBody, data } = await readHeartbeatResponse(response)
          const responseAt = new Date().toISOString()
          if (!response.ok || !data.accepted) {
            console.error('[ADP playback] heartbeat rejected', {
              requestId: item.requestId,
              clientSequence: item.clientSequence,
              expectedVersion: item.expectedVersion,
              kind: item.kind,
              status: response.status,
              contentType,
              rawBody,
              code: data.code,
              reason: data.error || data.reason,
              sessionVersion: data.version,
              acceptedPosition: data.acceptedPosition,
              serverIsPlaying: data.serverIsPlaying,
              serverElapsed: data.serverElapsed,
              transactionStartedAt: data.transactionStartedAt,
              databaseRequestAt: data.requestAt,
              previousHeartbeatAt: data.previousHeartbeatAt,
              previousPosition: data.acceptedPosition,
              eligibleBudget: data.eligibleBudget,
              allowedAdvance: data.allowedAdvance,
              actualAdvance: data.actualAdvance,
              scheduledAt: item.scheduledAt,
              sentAt,
              responseAt,
            })
            if (Number.isInteger(data.version)) sessionVersion.current = data.version
            if (Number.isSafeInteger(data.currentLastEventSequence ?? data.lastEventSequence)) {
              requestSequence.current = Math.max(requestSequence.current, data.currentLastEventSequence ?? data.lastEventSequence)
            }
            if (data.serverIsPlaying !== undefined) serverPlaying.current = data.serverIsPlaying
            if (serverPlaying.current === false) {
              pausePending.current = false
              pauseRecoveryAttempted.current = false
            }
            if (item.kind === 'play' && activationRequestId.current === item.requestId) {
              activatingPlayback.current = false
              activationRequestId.current = null
              playbackActive.current = false
              setBuffering(false)
              setPlaying(false)
              if (ref.current && !ref.current.paused) {
                suppressPauseEvent.current = true
                ref.current.pause()
              }
            }
            if (data.code === 'stale_version') {
              confirmedPosition.current = data.acceptedPosition ?? confirmedPosition.current
              setMessage('A newer playback event was accepted. The next event will resynchronize; this event was not applied.')
            } else if (data.code === 'stale_event') {
              setMessage('An older playback event was rejected. Current server progress is unchanged.')
            } else if (data.code === 'sequence_out_of_range') {
              requestSequence.current = data.lastEventSequence ?? 0
              playbackActive.current = false
              ref.current?.pause()
              setMessage('Playback event ordering could not be resynchronized. Reopen the lesson to start a fresh session.')
            } else if (data.code === 'session_expired' || data.code === 'session_inactive' || data.code === 'asset_version_changed') {
              playbackActive.current = false
              ref.current?.pause()
              setMessage(data.error || 'Playback session ended. Reopen the lesson from the library.')
            } else if (response.status === 403) {
              ref.current?.pause()
              setMessage('Access was revoked or this playback session expired. Reopen the lesson from the library.')
            } else if (data.code === 'client_upgrade_required') {
              ref.current?.pause()
              setMessage('The portal was updated. Reload this lesson to continue safely.')
            } else {
              setMessage(`Progress was not accepted (${data.code || `HTTP ${response.status}`}). Playback was not added to confirmed progress.`)
            }
            return 'rejected'
          }

          sessionVersion.current = data.currentVersion ?? data.version
          confirmedPosition.current = data.currentAcceptedPosition ?? data.acceptedPosition
          serverPlaying.current = data.currentServerIsPlaying ?? data.serverIsPlaying
          if (!serverPlaying.current) {
            pausePending.current = false
            pauseRecoveryAttempted.current = false
          }
          if (data.currentSessionActive === false) {
            playbackActive.current = false
            activatingPlayback.current = false
            activationRequestId.current = null
            suppressPauseEvent.current = true
            ref.current?.pause()
            setPlaying(false)
            setMessage('This session was reset or replaced. Reopen the lesson from the library.')
            return 'rejected'
          }
          lastHeartbeat.current = Date.now()
          if (!data.duplicate || (data.currentVersion ?? data.version) === data.version) {
            intervals.current = data.intervals ?? intervals.current
            setConfirmed(data.percent ?? 0)
          }
          console.info('[ADP playback] heartbeat accepted', {
            requestId: item.requestId,
            clientSequence: item.clientSequence,
            version: data.version,
            kind: item.kind,
            scheduledAt: item.scheduledAt,
            sentAt,
            responseAt,
            databaseRequestAt: data.requestAt,
            previousHeartbeatAt: data.previousHeartbeatAt,
            previousPosition: data.previousPosition,
            acceptedPosition: data.acceptedPosition,
            serverElapsed: data.serverElapsed,
            budgetSeconds: data.budgetSeconds,
              lastEventSequence: data.lastEventSequence,
            intervalInserted: data.intervalInserted,
            intervalCount: data.intervals?.length,
            percent: data.percent,
            duplicate: data.duplicate,
            serverIsPlaying: data.serverIsPlaying,
          })
          if (data.complete && (!data.duplicate || (data.currentVersion ?? data.version) === data.version)) setMessage('Training complete.')
          if (item.kind === 'play' && activationRequestId.current === item.requestId) {
            activatingPlayback.current = false
            activationRequestId.current = null
            pausePending.current = false
            playbackActive.current = true
            lastPosition.current = data.acceptedPosition
            setPosition(data.acceptedPosition)
            setBuffering(false)
            setPlaying(true)
            setMessage('Progress saves automatically.')
            if (ref.current) {
              ref.current.currentTime = data.acceptedPosition
              void ref.current.play().catch(() => {
                playbackActive.current = false
                setPlaying(false)
                setMessage('Playback could not resume after the server confirmed the session. Press play to retry.')
              })
            }
          }
          return 'accepted'
        } catch (error) {
          console.error('[ADP playback] heartbeat network failure', {
            requestId: item.requestId,
            clientSequence: item.clientSequence,
            expectedVersion: item.expectedVersion,
            kind: item.kind,
            scheduledAt: item.scheduledAt,
            sentAt,
            error: String(error),
          })
          setMessage('Network interruption: progress is not confirmed. The same request will retry before newer progress.')
          return 'network-error'
        }
      }

      // A transport failure has an unknown outcome. Retry the identical request
      // first so the server can return its idempotent result before later events.
      if (pendingRequest.current) {
        const retrying = pendingRequest.current
        const retryResult = await send(retrying)
        if (retryResult === 'network-error') {
          if (kind === 'periodic') periodicPending.current = false
          return
        }
        pendingRequest.current = null
          if (retryResult === 'rejected') {
          const recoveryKind = transitionRecoveryKind(retrying.kind, false, serverPlaying.current, pauseRecoveryAttempted.current, retrying.intentGeneration, intentGeneration.current)
          if (recoveryKind && retrying.intentGeneration === intentGeneration.current) {
            pauseRecoveryAttempted.current = true
            save(confirmedPosition.current, false, recoveryKind)
          } else if (retrying.kind === 'pause' || retrying.kind === 'buffering') {
            setMessage(serverPlaying.current
              ? 'Pause was not confirmed. Playback remains stopped; resume will resynchronize from confirmed progress.'
              : 'Playback is paused on the server. No rejected position was added to progress.')
          }
          // A newer intent must still be sent after an older retry was rejected.
          if (request.intentGeneration <= retrying.intentGeneration) {
            if (kind === 'periodic') periodicPending.current = false
            return
          }
        }
      }

      pendingRequest.current = request
      const result = await send(request)
      if (result !== 'network-error') pendingRequest.current = null
      if (result === 'rejected') {
        const recoveryKind = transitionRecoveryKind(request.kind, false, serverPlaying.current, pauseRecoveryAttempted.current, request.intentGeneration, intentGeneration.current)
        if (recoveryKind && generation === intentGeneration.current) {
          // Stop server active-time accounting at the last accepted position.
          // The rejected advancement is not replayed or promoted by this recovery.
          pauseRecoveryAttempted.current = true
          save(confirmedPosition.current, false, recoveryKind)
        } else if (request.kind === 'pause' || request.kind === 'buffering') {
          setMessage(serverPlaying.current
            ? 'Pause was not confirmed. Playback remains stopped; resume will resynchronize from confirmed progress.'
            : 'Playback is paused on the server. No rejected position was added to progress.')
        }
      }
      if (kind === 'periodic') periodicPending.current = false
    })
    return request.requestId
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return
    const loaded = () => {
      if (resumeAt.current > 0) el.currentTime = resumeAt.current
      lastPosition.current = resumeAt.current
      setPosition(resumeAt.current)
      setBuffering(false)
    }
    const maybePeriodic = (source: string) => {
      if (el.paused || el.seeking || !playbackActive.current || !serverPlaying.current || periodicPending.current) return
      if (Date.now() - lastHeartbeat.current >= 8000) {
        console.info('[ADP playback] periodic heartbeat scheduled', {
          source,
          mediaTime: el.currentTime,
          paused: el.paused,
          seeking: el.seeking,
          playbackActive: playbackActive.current,
          serverPlaying: serverPlaying.current,
          elapsedSinceAccepted: Date.now() - lastHeartbeat.current,
        })
        save(el.currentTime, true, 'periodic')
      }
    }
    const time = () => {
      const current = el.currentTime
      const prior = lastPosition.current
      if (current > prior + 1.75 && !isCovered(prior)) {
        el.currentTime = prior
        setMessage('Forward seeking into unwatched sections is disabled.')
        return
      }
      lastPosition.current = current
      setPosition(current)
      maybePeriodic('timeupdate')
    }
    const seeking = () => {
      const target = el.currentTime
      const prior = lastPosition.current
      if (target > prior + 1.5 && !isForwardPathCovered(prior, target)) {
        el.currentTime = seekBack.current ?? prior
        setMessage('You can only seek within sections already watched.')
      } else {
        seekBack.current = null
        lastPosition.current = target
        setPosition(target)
      }
    }
    const seeked = () => {
      if (isCovered(el.currentTime)) save(el.currentTime, !el.paused, 'seek')
    }
    const play = () => {
      setBuffering(true)
      setPlaying(false)
    }
    const playingNow = () => {
      if (requiresServerPlayActivation(serverPlaying.current, pausePending.current)) {
        activatingPlayback.current = true
        playbackActive.current = false
        setPlaying(false)
        setBuffering(true)
        setMessage('Starting verified playback…')
        if (!el.paused) {
          suppressPauseEvent.current = true
          el.pause()
        }
        activationRequestId.current = save(confirmedPosition.current, true, 'play')
        return
      }
      playbackActive.current = true
      setPlaying(true)
      setBuffering(false)
      save(el.currentTime, true, 'play')
    }
    const pause = () => {
      if (suppressPauseEvent.current || activatingPlayback.current) {
        suppressPauseEvent.current = false
        setPlaying(false)
        return
      }
      playbackActive.current = false
      pauseRecoveryAttempted.current = false
      setPlaying(false)
      save(el.currentTime, false, 'pause')
    }
    const wait = () => {
      playbackActive.current = false
      pauseRecoveryAttempted.current = false
      setBuffering(true)
      setPlaying(false)
      save(el.currentTime, false, 'buffering')
    }
    const can = () => setBuffering(false)
    const ended = () => {
      playbackActive.current = false
      setPlaying(false)
      save(el.currentTime, false, 'complete')
    }
    const periodicTimer = setInterval(() => maybePeriodic('timer'), 1000)
    el.addEventListener('loadedmetadata', loaded)
    el.addEventListener('timeupdate', time)
    el.addEventListener('seeking', seeking)
    el.addEventListener('seeked', seeked)
    el.addEventListener('play', play)
    el.addEventListener('playing', playingNow)
    const unbindPauseBuffer = bindPauseBufferEvents(el, {
      onPause: () => pause(),
      onBuffering: () => wait(),
    })
    el.addEventListener('canplay', can)
    el.addEventListener('ended', ended)
    if (el.readyState >= 1) loaded()
    if (!el.paused) playingNow()
    return () => {
      clearInterval(periodicTimer)
      el.removeEventListener('loadedmetadata', loaded)
      el.removeEventListener('timeupdate', time)
      el.removeEventListener('seeking', seeking)
      el.removeEventListener('seeked', seeked)
      el.removeEventListener('play', play)
      el.removeEventListener('playing', playingNow)
      unbindPauseBuffer()
      el.removeEventListener('canplay', can)
      el.removeEventListener('ended', ended)
    }
  }, [ready, duration, save])

  const seek = (value: number) => {
    const el = ref.current
    if (!el) return
    if (value > position + 1.5 && !isForwardPathCovered(position, value)) {
      setMessage('That section has not been watched yet.')
      return
    }
    seekBack.current = position
    el.currentTime = value
    setPosition(value)
  }
  const reveal = () => {
    setControlsVisible(true)
    if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
    if (playing) hiddenTimer.current = setTimeout(() => setControlsVisible(false), 3000)
  }

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true)
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
    } else reveal()
    return () => {
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
    }
  }, [playing])

  useEffect(() => {
    const onFullscreen = () => {
      setControlsVisible(true)
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
      if (document.fullscreenElement === container.current && playing) {
        hiddenTimer.current = setTimeout(() => setControlsVisible(false), 3000)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [playing])

  const segments = Array.from({ length: Math.max(1, Math.ceil(duration)) }, (_, second) =>
    intervals.current.some((interval) => interval.start_seconds < second + 1 && interval.end_seconds > second),
  )
  if (!playbackId || !token) {
    return <div className="video-frame"><div className="player-placeholder">Video is processing or secure playback is unavailable.</div></div>
  }

  return <>
    <div
      ref={container}
      className={`adp-player ${controlsVisible ? 'controls-visible' : 'controls-hidden'}`}
      onMouseMove={reveal}
      onMouseEnter={reveal}
      onMouseLeave={() => {
        if (playing) {
          if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
          hiddenTimer.current = setTimeout(() => setControlsVisible(false), 3000)
        }
      }}
      onPointerDown={(event) => { if (event.pointerType === 'touch') setControlsVisible((visible) => !visible); else reveal() }}
      onKeyDown={reveal}
    >
      <MediaPlayer
        ref={ref}
        playbackId={playbackId}
        tokens={{ playback: token }}
        streamType="on-demand"
        metadata={{ video_id: videoId }}
        playbackRates={[1]}
        disablePictureInPicture
        onVolumeChange={(event) => {
          const el = event.currentTarget as any
          setVolume(el.volume)
          setMuted(el.muted)
        }}
        style={{ width: '100%', height: '100%' }}
      />
      <div className="player-state" aria-live="polite">{buffering ? <><span className="spinner"/> Buffering</> : playing ? 'Playing' : 'Paused'}</div>
      <div className="adp-controls" aria-hidden={!controlsVisible} inert={!controlsVisible}>
        <button className="player-button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => playing ? ref.current?.pause() : void ref.current?.play()}>{playing ? 'Ⅱ' : '▶'}</button>
        <span className="time-label">{fmt(position)}</span>
        <div className="timeline-wrap"><div className="timeline-track"><div className="watched-track">{segments.map((watched, second) => watched && <i key={second} style={{ left: `${second / duration * 100}%`, width: `${100 / duration}%` }}/>)}</div><div className="playhead" style={{ left: `${duration ? position / duration * 100 : 0}%` }}/><input aria-label="Video timeline" type="range" min={0} max={duration || 1} step="0.1" value={position} onChange={(event) => seek(Number(event.target.value))} onPointerDown={reveal} onFocus={reveal}/></div></div>
        <span className="time-label">{fmt(duration)}</span>
        <button className="player-button" aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'} onClick={() => { reveal(); if (ref.current) { ref.current.muted = !ref.current.muted; setMuted(ref.current.muted) } }}>{muted || volume === 0 ? '×' : '◖'}</button>
        <input className="volume-slider" aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => { reveal(); const next = Number(event.target.value); if (ref.current) { ref.current.volume = next; ref.current.muted = next === 0 } setVolume(next); setMuted(next === 0) }} onPointerDown={reveal} onFocus={reveal}/>
        <button className="player-button" aria-label="Fullscreen" onClick={() => { reveal(); void container.current?.requestFullscreen?.() }}>⛶</button>
      </div>
    </div>
    <div className="notice">{complete ? 'This lesson is recorded as complete.' : message} · {confirmed}% server-confirmed</div>
    <div className="bar"><span style={{ width: `${complete ? 100 : confirmed}%` }}/></div>
  </>
}
