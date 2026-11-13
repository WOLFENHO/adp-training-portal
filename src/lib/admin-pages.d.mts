export function collectPages<T>(fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; count: number | null; error: unknown }>, pageSize?: number, maximumRows?: number): Promise<T[]>
export function assertDashboardSize(profileCount: number, videoCount: number, maximumPairs?: number): void
