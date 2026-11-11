export function playbackSessionMessage(code?: string, fallback?: string): string
export function adminDashboardMessage(code?: string): string
export function adminActionMessage(code?: string): string | null
export function adminMutationMessage(action: string, response: Record<string, unknown>, status: number): string
