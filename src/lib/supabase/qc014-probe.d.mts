export const REHEARSAL_REF: string
export type ProbeResult = { expectedProjectRef: string; ok: boolean; code: string }
export function checkProbeAccess(env: NodeJS.ProcessEnv, presented: string): ProbeResult
export function probeIdentity(env: NodeJS.ProcessEnv, presented: string, readRelease: (url: string, key: string) => Promise<{ version: number; ready: boolean } | null>): Promise<ProbeResult>
