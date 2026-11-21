import { createClient } from '@/lib/supabase/server'

/** The authenticated RPC checks the caller and current asset-bound completion.
 * A database error must never unlock playback. */
export async function trainingUnlocked(videoId: string): Promise<boolean> {
  const db = await createClient()
  const { data, error } = await db.rpc('adp_training_unlocked_r121', { p_video_id: videoId })
  if (error || typeof data !== 'boolean') throw new Error('training_unlock_unavailable')
  return data
}
