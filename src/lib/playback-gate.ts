import { createClient } from '@/lib/supabase/server'

export type PlaybackGate =
  | { enabled: true }
  | { enabled: false; error: 'playback_maintenance' | 'playback_schema_unavailable' }

/** Fail closed unless both the Sites runtime switch and database readiness pass. */
export async function getPlaybackGate(): Promise<PlaybackGate> {
  if (process.env.PLAYBACK_HEARTBEATS_ENABLED !== 'true') {
    return { enabled: false, error: 'playback_maintenance' }
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('adp_playback_integrity_version')
    if (error || data !== 121) {
      console.error('[ADP playback] Playback readiness check failed', {
        code: error?.code ?? null,
        version: data ?? null,
      })
      return { enabled: false, error: 'playback_schema_unavailable' }
    }
    return { enabled: true }
  } catch (error) {
    console.error('[ADP playback] Playback readiness check could not run', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return { enabled: false, error: 'playback_schema_unavailable' }
  }
}
