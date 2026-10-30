export type Video = { id: string; title: string; description: string; thumbnail_url: string | null; duration_seconds: number; playback_id: string | null; asset_id: string | null; duration_precision_verified: boolean; published: boolean; sort_order: number }
export type Progress = {
  watched_seconds: number
  verified_watched_seconds: number
  verified_percent: number
  status: 'unstarted' | 'in_progress' | 'verified_completed' | 'historical_completed'
  completed_at: string | null
  historical_completed_at: string | null
  verified_completed_at: string | null
}
