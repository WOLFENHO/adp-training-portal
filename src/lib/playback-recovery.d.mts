export function fetchWithDeadline<T>(fetcher: (url: string, options: RequestInit) => Promise<T>, url: string, options: RequestInit, milliseconds?: number): Promise<T>
export type RetryOutcome = 'accepted' | 'rejected' | 'network-error'
export interface ReceiptRetry<T> {
  remember(item: T): void
  resolve(item: T): void
  retryNow(): Promise<void>
  hasPending(): boolean
  dispose(): void
}
export function createReceiptRetry<T>(options: {
  attempt: (item: T) => Promise<RetryOutcome>
  schedule?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  cancel?: (timer: ReturnType<typeof setTimeout>) => void
}): ReceiptRetry<T>
export interface ReceiptBarrier<T> {
  hold(item: T): void
  wait(): Promise<boolean>
  settle(item: T): void
  dispose(): void
}
export function createReceiptBarrier<T>(): ReceiptBarrier<T>
