export function safeSessionRpcError(error: { message?: string } | null): { status: number; code: string; errorId: string }
export function sameOriginMutation(request: Request): boolean
