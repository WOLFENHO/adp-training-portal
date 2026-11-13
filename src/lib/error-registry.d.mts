export function identifyError(code: string): { errorId: string; status: number; message: string }
export function sanitizeApiError(code: string, correlationId: string, untrusted?: unknown): { error: string; errorId: string; correlationId: string; reason: string }
