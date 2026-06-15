import type { DrawNetworkKey } from '../contracts/luckyDrawNetworks'

export type DrawTransactionKind = 'reset' | 'finalize' | 'request' | 'reveal'
export type DrawTransactionStatus = 'awaiting-signature' | 'pending' | 'confirmed' | 'failed'

export interface DrawTransactionRecord {
  id: string
  networkKey: DrawNetworkKey
  contractAddress?: string
  ledgerHash?: string
  kind: DrawTransactionKind
  status: DrawTransactionStatus
  startedAt: number
  submittedAt?: number
  confirmedAt?: number
  hash?: string
  detail?: string
  error?: string
}

export interface DrawVrfTiming {
  requestConfirmedAt?: number
  pendingObservedAt?: number
  randomnessReadyAt?: number
}

export type DrawTransactionRecordsByNetwork = Partial<Record<DrawNetworkKey, DrawTransactionRecord[]>>
export type DrawVrfTimingByNetwork = Partial<Record<DrawNetworkKey, DrawVrfTiming>>

export function formatDurationMs(value: number | undefined): string {
  if (!value || value < 0) return '-'
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`
  const totalSeconds = Math.round(value / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function transactionDuration(record: DrawTransactionRecord, now = Date.now()): string {
  const end = record.confirmedAt ?? (record.status === 'failed' ? record.submittedAt : now)
  return formatDurationMs(end ? end - record.startedAt : undefined)
}
