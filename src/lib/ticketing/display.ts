import type { RaffleEntry, RaffleLedger, TicketInterval } from './types'
import { formatTicketRange } from './rules'
import { TOTAL_PRIZE_SLOTS } from '../prizes/prizes'

export function percent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  if (value < 0.0001) return `${(value * 100).toFixed(4)}%`
  return `${(value * 100).toFixed(2)}%`
}

export function compactNumber(value: number | bigint): string {
  return new Intl.NumberFormat(undefined).format(Number(value || 0))
}

function ticketCode(value: number, prefix: string): string {
  return `${prefix}-${String(Math.max(0, Math.floor(value || 0))).padStart(6, '0')}`
}

export function intervalDisplayRange(interval: TicketInterval): string {
  const displayStart = interval.displayStart || interval.start
  const displayEnd = interval.displayEnd || interval.end
  const namespace =
    interval.namespace ||
    (interval.source === 'sbt-bonus' ? 'bonus' : interval.source === 'estimate' ? 'estimate' : 'raw')

  if (namespace === 'raw') {
    const start = ticketCode(displayStart, 'R')
    const end = ticketCode(displayEnd, 'R')
    return displayStart === displayEnd ? start : `${start}-${end}`
  }

  if (namespace === 'bonus') {
    const start = ticketCode(displayStart, 'B')
    const end = ticketCode(displayEnd, 'B')
    return displayStart === displayEnd ? start : `${start}-${end}`
  }

  return formatTicketRange(displayStart, displayEnd)
}

export function probability(entry: RaffleEntry | null, totalTickets: number): number {
  if (!entry || totalTickets <= 0) return 0
  return entry.finalTickets / totalTickets
}

export function anyPrizeProbability(entry: RaffleEntry | null, totalTickets: number): number {
  const single = probability(entry, totalTickets)
  return single > 0 ? 1 - Math.pow(1 - single, TOTAL_PRIZE_SLOTS) : 0
}

export function entryMatches(entry: RaffleEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [entry.userAddress, ...entry.sourceAddresses].some((address) => address.includes(normalized))
}

export function entryRange(entry: RaffleEntry, mode: RaffleLedger['mode']): string {
  if (mode !== 'buyback-ledger') return 'Generate buyback ledger'
  if (entry.ticketIntervals.length === 0) return '-'
  if (entry.ticketIntervals.length > 1) {
    return `${compactNumber(entry.rawTickets)} R + ${compactNumber(entry.bonusTickets)} B`
  }
  return intervalDisplayRange(entry.ticketIntervals[0])
}

export function intervalLabel(interval: TicketInterval): string {
  const source = interval.source === 'sbt-bonus' ? 'SBT bonus' : 'Buyback'
  return `${intervalDisplayRange(interval)} · ${source}`
}
