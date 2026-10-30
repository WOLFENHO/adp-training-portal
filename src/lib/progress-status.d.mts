type VideoVersion = { asset_id: string | null; duration_seconds: number; duration_precision_verified: boolean }
type VerifiedCompletion = { asset_id: string; duration_seconds: number; validator_version: number; completed_at: string }
type HistoricalCompletion = { completed_at: string; method?: string }
type ProgressRow = { verified_watched_seconds?: number | null; completed_at?: string | null }
export function summarizeVideoProgress(video: VideoVersion, progress: ProgressRow | null | undefined, verifiedRows?: VerifiedCompletion[], historicalRows?: HistoricalCompletion[]): {
  currentVerified: boolean
  percent: number
  status: 'verified_completed' | 'historical_completed' | 'in_progress' | 'unstarted'
  label: string
  historicalCompletedAt: string | null
  verifiedWatchedSeconds: number
}
