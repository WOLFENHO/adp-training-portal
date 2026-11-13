export type AdminView = 'videos' | 'profiles' | 'progress'
export function encodeAdminCursor(view: AdminView, values: string[]): string
export function pageAdminRows<T = Record<string, unknown>>(db: { from: (table: string) => any }, options: { view: AdminView; limit?: number; cursor?: string | null; maxBytes?: number }): Promise<{ rows: T[]; nextCursor: string | null }>
