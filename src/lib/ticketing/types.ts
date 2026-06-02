export type SbtTier = 'none' | 'brown' | 'silver' | 'gold' | 'rainbow'

export type PackKey = 'omega' | 'eden' | 'costume-pack' | 'magma'

export type PackCounts = Record<PackKey, number>

export type LedgerMode = 'buyback-ledger' | 'open-monitor-estimate'

export type TicketIntervalSource = 'buyback-event' | 'pack-open' | 'sbt-bonus' | 'estimate'

export type TicketIntervalNamespace = 'raw' | 'bonus' | 'estimate'

export interface TicketInterval {
  start: number
  end: number
  displayStart?: number
  displayEnd?: number
  namespace?: TicketIntervalNamespace
  source: TicketIntervalSource
  pack?: PackKey
  txHash?: string
  timestamp?: number
  blockNumber?: number
  ordinal?: number
}

export interface BuybackEvent {
  id: string
  canonicalAddress: string
  sourceAddress: string
  txHash: string
  timestamp: number
  blockNumber: number
  ordinal: number
  contractAddress: string
  pack: PackKey
  ticketWeight: number
  itemName: string
  checkoutId: string | null
  tokenId: string | null
  priceInUsdt: string | null
}

export interface RaffleEntry {
  rank: number
  userAddress: string
  sourceAddresses: string[]
  packs: PackCounts
  baseTickets: number
  bonusTickets: number
  rawTickets: number
  sbt: SbtTier
  sbtMultiplier: number
  finalTickets: number
  ticketStart: number | null
  ticketEnd: number | null
  ticketIntervals: TicketInterval[]
  firstBuybackAt: number | null
  lastBuybackAt: number | null
  eventCount: number
  dataWarnings: string[]
  ticketIntervalCount?: number
  ticketIntervalsOffset?: number
  ticketIntervalsLimit?: number
  ticketIntervalsComplete?: boolean
}

export interface RaffleLeaderboardEntry {
  rank: number
  userAddress: string
  sourceAddresses: string[]
  rawTickets: number
  bonusTickets: number
  finalTickets: number
  sbt: SbtTier
  sbtMultiplier: number
  eventCount: number
}

export interface RaffleLedger {
  mode: LedgerMode
  generatedAt: number
  campaignStart: number
  campaignEnd: number
  totalEntries: number
  totalRawTickets: number
  totalBonusTickets: number
  totalFinalTickets: number
  sourceEntries: number
  candidateSourceLimited: boolean
  ledgerHash: string | null
  drawContractAddress: string | null
  bonusShuffleVersion?: string | null
  bonusShuffleSeed?: string | null
  bonusShuffleLocked?: boolean
  bonusShuffleLockedAt?: number | null
  entries: RaffleEntry[]
  leaderboardEntries?: RaffleLeaderboardEntry[]
  notes: string[]
}

export interface OpenMonitorEntry {
  rank: number
  user_address: string
  omega_pulls?: number
  eden_pulls?: number
  costume_pulls?: number
  magma_pulls?: number
  raw_tickets?: number
  sbt?: SbtTier
  sbt_multiplier?: number
  final_tickets?: number
  merged_from?: string[]
}

export interface OpenMonitorLuckyDrawResponse {
  campaign_start: number
  campaign_end: number
  generated_at: number
  total_entries: number
  total_final_tickets: number
  entries: OpenMonitorEntry[]
}
