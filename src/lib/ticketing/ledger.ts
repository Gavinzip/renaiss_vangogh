import {
  calculateFinalTickets,
  calculateRawTickets,
  emptyPackCounts,
  getSbtTier,
  normalizeAddress,
} from './rules'
import type {
  OpenMonitorLuckyDrawResponse,
  PackCounts,
  PackRule,
  RaffleEntry,
  RaffleLedger,
  RaffleLeaderboardEntry,
  SbtTier,
  TicketInterval,
} from './types'

function toInteger(value: unknown): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

function normalizeSbt(value: unknown): SbtTier {
  const text = String(value || 'none').trim().toLowerCase()
  if (text === 'bronze') return 'brown'
  return ['brown', 'silver', 'gold', 'rainbow'].includes(text) ? (text as SbtTier) : 'none'
}

function normalizeLeaderboardEntry(value: unknown, index: number): RaffleLeaderboardEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<RaffleLeaderboardEntry>
  const userAddress = normalizeAddress(entry.userAddress)
  if (!userAddress) return null
  const sourceAddresses = (entry.sourceAddresses || [userAddress]).map(normalizeAddress).filter(Boolean)

  return {
    rank: Number(entry.rank || index + 1),
    userAddress,
    sourceAddresses,
    rawTickets: toInteger(entry.rawTickets),
    bonusTickets: toInteger(entry.bonusTickets),
    finalTickets: toInteger(entry.finalTickets),
    sbt: normalizeSbt(entry.sbt),
    sbtMultiplier: Number(entry.sbtMultiplier || 1),
    eventCount: toInteger(entry.eventCount),
  }
}

function normalizePackRule(value: unknown): PackRule | null {
  if (!value || typeof value !== 'object') return null
  const rule = value as Partial<PackRule>
  const pack = String(rule.pack || '').trim()
  const label = String(rule.label || '').trim()
  const ticketWeight = toInteger(rule.ticketWeight)
  if (!pack || !label || ticketWeight <= 0) return null
  return {
    pack,
    label,
    ticketWeight,
    contract: rule.contract || null,
    openContract: rule.openContract || null,
    buybackContract: rule.buybackContract || null,
    eventKind: rule.eventKind || null,
    eventTopic: rule.eventTopic || null,
    topic1: rule.topic1 || null,
    topic2: rule.topic2 || null,
    topic3: rule.topic3 || null,
    packId: rule.packId || null,
    configSource: rule.configSource || null,
  }
}

export function withTicketRanges(entries: RaffleEntry[]): RaffleEntry[] {
  let cursor = 0
  return entries.map((entry, index) => {
    const start = entry.finalTickets > 0 ? cursor + 1 : null
    const end = entry.finalTickets > 0 ? cursor + entry.finalTickets : null
    const intervals: TicketInterval[] =
      start && end
        ? [
            {
              start,
              end,
              displayStart: start,
              displayEnd: end,
              namespace: 'estimate',
              source: entry.ticketIntervals.length > 0 ? entry.ticketIntervals[0].source : 'estimate',
            },
          ]
        : []
    cursor += entry.finalTickets
    return {
      ...entry,
      rank: index + 1,
      ticketStart: start,
      ticketEnd: end,
      ticketIntervals: entry.ticketIntervals.length > 0 ? entry.ticketIntervals : intervals,
    }
  })
}

function intervalBounds(intervals: TicketInterval[]): { start: number | null; end: number | null } {
  const usable = intervals.filter((interval) => interval.start > 0 && interval.end >= interval.start)
  if (usable.length === 0) return { start: null, end: null }
  return {
    start: Math.min(...usable.map((interval) => interval.start)),
    end: Math.max(...usable.map((interval) => interval.end)),
  }
}

export function buildLedgerFromOpenMonitor(data: OpenMonitorLuckyDrawResponse): RaffleLedger {
  const entries = (data.entries || []).map((row): RaffleEntry => {
    const packs: PackCounts = {
      ...emptyPackCounts(),
      omega: toInteger(row.omega_pulls),
      eden: toInteger(row.eden_pulls),
      'costume-pack': toInteger(row.costume_pulls),
      magma: toInteger(row.magma_pulls),
    }
    const rawTickets = calculateRawTickets(packs)
    const inferredTier = getSbtTier(rawTickets)
    const sbt = inferredTier.tier
    const sbtMultiplier = inferredTier.multiplier
    const finalTickets = calculateFinalTickets(rawTickets, sbtMultiplier)
    const bonusTickets = Math.max(0, finalTickets - rawTickets)
    const userAddress = normalizeAddress(row.user_address)
    const merged = (row.merged_from || []).map(normalizeAddress).filter(Boolean)

    return {
      rank: row.rank,
      userAddress,
      sourceAddresses: [userAddress, ...merged].filter(Boolean),
      packs,
      baseTickets: rawTickets,
      bonusTickets,
      rawTickets,
      sbt,
      sbtMultiplier,
      finalTickets,
      ticketStart: null,
      ticketEnd: null,
      ticketIntervals: [],
      firstBuybackAt: null,
      lastBuybackAt: null,
      eventCount: Object.values(packs).reduce((sum, count) => sum + count, 0),
      dataWarnings: [
        'Open Monitor source is a maximum estimate and does not prove buyback completion.',
      ],
    }
  })

  return {
    mode: 'open-monitor-estimate',
    generatedAt: toInteger(data.generated_at),
    campaignStart: toInteger(data.campaign_start),
    campaignEnd: toInteger(data.campaign_end),
    totalEntries: toInteger(data.total_entries),
    totalFinalTickets: entries.reduce((sum, entry) => sum + entry.finalTickets, 0),
    sourceEntries: entries.length,
    candidateSourceLimited: entries.length < toInteger(data.total_entries),
    totalRawTickets: entries.reduce((sum, entry) => sum + entry.rawTickets, 0),
    totalBonusTickets: entries.reduce((sum, entry) => sum + entry.bonusTickets, 0),
    ledgerHash: null,
    drawContractAddress: null,
    packRules: [],
    entries,
    leaderboardEntries: entries.slice(0, 10).map((entry) => ({
      rank: entry.rank,
      userAddress: entry.userAddress,
      sourceAddresses: entry.sourceAddresses,
      rawTickets: entry.rawTickets,
      bonusTickets: entry.bonusTickets,
      finalTickets: entry.finalTickets,
      sbt: entry.sbt,
      sbtMultiplier: entry.sbtMultiplier,
      eventCount: entry.eventCount,
    })),
    notes: [
      'This view is a fallback estimate from Open Monitor. Generate public/lucky-draw-ledger.json for verified buyback tickets.',
      'Ticket ranges are intentionally hidden in estimate mode because buyback timestamps are not verified.',
    ],
  }
}

export function sortBuybackLedgerEntries(entries: RaffleEntry[]): RaffleEntry[] {
  const sorted = [...entries].sort((left, right) => {
    const leftTs = left.firstBuybackAt || Number.MAX_SAFE_INTEGER
    const rightTs = right.firstBuybackAt || Number.MAX_SAFE_INTEGER
    if (leftTs !== rightTs) return leftTs - rightTs
    return left.userAddress.localeCompare(right.userAddress)
  })
  return withTicketRanges(sorted)
}

export function normalizeLoadedLedger(value: unknown): RaffleLedger | null {
  if (!value || typeof value !== 'object') return null
  const maybe = value as Partial<RaffleLedger>
  if (!Array.isArray(maybe.entries)) return null
  if (maybe.mode !== 'buyback-ledger' && maybe.mode !== 'open-monitor-estimate') return null
  const sourcePackRulesValue = (maybe as { source?: { packEventSources?: unknown[] } }).source?.packEventSources
  const sourcePackRules = Array.isArray(sourcePackRulesValue) ? sourcePackRulesValue : []
  const packRules = (Array.isArray(maybe.packRules) ? maybe.packRules : sourcePackRules)
    .map((rule) => normalizePackRule(rule))
    .filter((rule): rule is PackRule => Boolean(rule))
  const legacyTotalRawTickets = toInteger(
    maybe.totalRawTickets ||
      maybe.entries.reduce((sum, entry) => sum + toInteger((entry as Partial<RaffleEntry>).rawTickets), 0),
  )
  const entries = maybe.entries
    .map((entry, idx): RaffleEntry | null => {
      const userAddress = normalizeAddress(entry.userAddress)
      if (!userAddress) return null
      const packs = { ...emptyPackCounts(), ...(entry.packs || {}) }
      const ticketIntervals = Array.isArray(entry.ticketIntervals)
        ? entry.ticketIntervals
            .map((interval): TicketInterval | null => {
              const start = toInteger(interval.start)
              const end = toInteger(interval.end)
              if (!start || !end || end < start) return null
              const namespace =
                interval.namespace ||
                (interval.source === 'sbt-bonus'
                  ? 'bonus'
                  : interval.source === 'estimate'
                    ? 'estimate'
                    : 'raw')
              const legacyBonusDisplayStart = namespace === 'bonus' ? start - legacyTotalRawTickets : start
              const legacyBonusDisplayEnd = namespace === 'bonus' ? end - legacyTotalRawTickets : end
              return {
                start,
                end,
                displayStart: toInteger(interval.displayStart) || Math.max(1, legacyBonusDisplayStart),
                displayEnd: toInteger(interval.displayEnd) || Math.max(1, legacyBonusDisplayEnd),
                namespace,
                source: interval.source || 'buyback-event',
                pack: interval.pack,
                txHash: interval.txHash,
                timestamp: interval.timestamp,
                blockNumber: toInteger(interval.blockNumber),
                ordinal: toInteger(interval.ordinal),
              }
            })
            .filter((interval): interval is TicketInterval => Boolean(interval))
        : []
      const bounds = intervalBounds(ticketIntervals)
      const rawTickets = toInteger(entry.rawTickets)
      const finalTickets = toInteger(entry.finalTickets)
      return {
        rank: Number(entry.rank || idx + 1),
        userAddress,
        sourceAddresses: (entry.sourceAddresses || [userAddress]).map(normalizeAddress).filter(Boolean),
        packs,
        baseTickets: toInteger(entry.baseTickets || rawTickets),
        bonusTickets: toInteger(entry.bonusTickets || Math.max(0, finalTickets - rawTickets)),
        rawTickets,
        sbt: normalizeSbt(entry.sbt),
        sbtMultiplier: Number(entry.sbtMultiplier || 1),
        finalTickets,
        ticketStart: entry.ticketStart ?? bounds.start,
        ticketEnd: entry.ticketEnd ?? bounds.end,
        ticketIntervals,
        firstBuybackAt: entry.firstBuybackAt ?? null,
        lastBuybackAt: entry.lastBuybackAt ?? null,
        eventCount: toInteger(entry.eventCount),
        dataWarnings: entry.dataWarnings || [],
      }
    })
    .filter((entry): entry is RaffleEntry => Boolean(entry))
  const leaderboardEntries = Array.isArray(maybe.leaderboardEntries)
    ? maybe.leaderboardEntries
        .map((entry, index) => normalizeLeaderboardEntry(entry, index))
        .filter((entry): entry is RaffleLeaderboardEntry => Boolean(entry))
      : entries.slice(0, 10).map((entry) => ({
        rank: entry.rank,
        userAddress: entry.userAddress,
        sourceAddresses: entry.sourceAddresses,
        rawTickets: entry.rawTickets,
        bonusTickets: entry.bonusTickets,
        finalTickets: entry.finalTickets,
        sbt: entry.sbt,
        sbtMultiplier: entry.sbtMultiplier,
        eventCount: entry.eventCount,
      }))

  return {
    mode: maybe.mode,
    generatedAt: toInteger(maybe.generatedAt),
    campaignStart: toInteger(maybe.campaignStart),
    campaignEnd: toInteger(maybe.campaignEnd),
    totalEntries: toInteger(maybe.totalEntries || entries.length),
    totalRawTickets: toInteger(
      maybe.totalRawTickets || entries.reduce((sum, entry) => sum + entry.rawTickets, 0),
    ),
    totalBonusTickets: toInteger(
      maybe.totalBonusTickets || entries.reduce((sum, entry) => sum + entry.bonusTickets, 0),
    ),
    totalFinalTickets: toInteger(
      maybe.totalFinalTickets || entries.reduce((sum, entry) => sum + entry.finalTickets, 0),
    ),
    sourceEntries: toInteger(maybe.sourceEntries || entries.length),
    candidateSourceLimited: Boolean(maybe.candidateSourceLimited),
    ledgerHash: maybe.ledgerHash || null,
    drawContractAddress: maybe.drawContractAddress || null,
    bonusShuffleVersion: maybe.bonusShuffleVersion || null,
    bonusShuffleSeed: maybe.bonusShuffleSeed || null,
    bonusShuffleLocked: Boolean(maybe.bonusShuffleLocked),
    bonusShuffleLockedAt: toInteger(maybe.bonusShuffleLockedAt),
    packRules,
    entries,
    leaderboardEntries,
    notes: maybe.notes || [],
  }
}
