export type AdminView = 'allowed' | 'videos' | 'profiles' | 'progress' | 'historical' | 'verified'
export function encodeAdminCursor(view: AdminView, values: string[], actorId?: string): string
export function pageAdminRows<T = Record<string, unknown>>(db: { from: (table: string) => any }, options: { view: AdminView; limit?: number; cursor?: string | null; maxBytes?: number; actorId?: string }): Promise<{ rows: T[]; nextCursor: string | null }>
