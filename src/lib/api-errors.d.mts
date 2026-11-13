export function safeSessionRpcError(error: { message?: string } | null): { status: number; code: string; errorId: string }
export function sameOriginMutation(request: Request): boolean
export function sanitizeHeartbeatRejection(data: Record<string, unknown> | null, correlationId: string): { accepted: false; code: string; error: string; errorId: string; correlationId: string; version?: number; lastEventSequence?: number; currentLastEventSequence?: number; acceptedPosition?: number; currentAcceptedPosition?: number; serverIsPlaying?: boolean; currentServerIsPlaying?: boolean }
