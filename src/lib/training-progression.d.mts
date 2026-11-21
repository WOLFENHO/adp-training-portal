type Video = { id: string; sort_order: number; published: boolean; asset_id: string | null; duration_seconds: number; duration_precision_verified: boolean }
type Verified = { video_id: string; validator_version?: number | null; asset_id?: string | null; duration_seconds?: number | null; asset_identity?: string | null; reset_at?: string | null; verified_at?: string | null }
export function currentVerifiedCompletion(video: Video, rows: Verified[]): boolean
export function trainingSequence(videos: Video[], verifiedRows: Verified[]): Record<string, boolean>
