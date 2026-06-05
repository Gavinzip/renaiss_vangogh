import { readFileSync, statSync } from 'node:fs'

export const DEFAULT_ENTRY_INTERVAL_LIMIT = 0
export const MAX_ENTRY_INTERVAL_LIMIT = 240
export const SUMMARY_LEADERBOARD_LIMIT = 10

let ledgerCache = {
  ledger: null,
  mtimeMs: -1,
  path: '',
}

export function readLedgerPayload(ledgerPath) {
  const stat = statSync(ledgerPath)
  if (ledgerCache.ledger && ledgerCache.path === ledgerPath && ledgerCache.mtimeMs === stat.mtimeMs) {
    return ledgerCache.ledger
  }

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  ledgerCache = {
    ledger,
    mtimeMs: stat.mtimeMs,
    path: ledgerPath,
  }
  return ledger
}

export function buildLedgerSummary(ledger) {
  return {
    mode: ledger.mode,
    generatedAt: Number(ledger.generatedAt || 0),
    campaignStart: Number(ledger.campaignStart || 0),
    campaignEnd: Number(ledger.campaignEnd || 0),
    totalEntries: Number(ledger.totalEntries || 0),
    totalRawTickets: Number(ledger.totalRawTickets || 0),
    totalBonusTickets: Number(ledger.totalBonusTickets || 0),
    totalFinalTickets: Number(ledger.totalFinalTickets || 0),
    sourceEntries: Number(ledger.sourceEntries || 0),
    candidateSourceLimited: Boolean(ledger.candidateSourceLimited),
    ledgerHash: ledger.ledgerHash || null,
    drawContractAddress: ledger.drawContractAddress || null,
    bonusShuffleVersion: ledger.bonusShuffleVersion || null,
    bonusShuffleSeed: ledger.bonusShuffleSeed || null,
    bonusShuffleLocked: Boolean(ledger.bonusShuffleLocked),
    bonusShuffleLockedAt: Number(ledger.bonusShuffleLockedAt || 0),
    packRules: Array.isArray(ledger.packRules) ? ledger.packRules : [],
    entries: [],
    leaderboardEntries: buildLeaderboardEntries(ledger, SUMMARY_LEADERBOARD_LIMIT),
    notes: Array.isArray(ledger.notes) ? ledger.notes : [],
  }
}

function buildLeaderboardEntries(ledger, limit) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  return entries.slice(0, limit).map((entry, index) => ({
    rank: Number(entry.rank || index + 1),
    userAddress: entry.userAddress || '',
    sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
    rawTickets: Number(entry.rawTickets || 0),
    bonusTickets: Number(entry.bonusTickets || 0),
    finalTickets: Number(entry.finalTickets || 0),
    sbt: entry.sbt || 'none',
    sbtMultiplier: Number(entry.sbtMultiplier || 1),
    eventCount: Number(entry.eventCount || 0),
  }))
}

export function findLedgerEntry(ledger, query) {
  const normalized = String(query || '').trim().toLowerCase()
  if (!normalized || !Array.isArray(ledger.entries)) return null

  return (
    ledger.entries.find((entry) => {
      const addresses = [entry.userAddress, ...(Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [])]
      return addresses.some((address) => String(address || '').toLowerCase().includes(normalized))
    }) || null
  )
}

export function findLedgerEntryByAddresses(ledger, addresses) {
  const normalizedAddresses = new Set(
    (Array.isArray(addresses) ? addresses : []).map((address) => String(address || '').trim().toLowerCase()).filter(Boolean),
  )
  if (!normalizedAddresses.size || !Array.isArray(ledger.entries)) return null

  return (
    ledger.entries.find((entry) => {
      const entryAddresses = [entry.userAddress, ...(Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [])]
      return entryAddresses.some((address) => normalizedAddresses.has(String(address || '').toLowerCase()))
    }) || null
  )
}

export function parseEntryIntervalQuery(searchParams) {
  const hasLimit = searchParams.has('intervalLimit')
  const includeAll = searchParams.get('intervalLimit') === 'all'
  const includeIntervals = includeAll || searchParams.get('includeIntervals') === '1' || hasLimit
  const rawOffset = Number(searchParams.get('intervalOffset') || 0)
  const rawLimit = Number(searchParams.get('intervalLimit') || DEFAULT_ENTRY_INTERVAL_LIMIT)

  return {
    includeIntervals,
    intervalOffset: Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0,
    intervalLimit: includeAll
      ? 'all'
      : Number.isFinite(rawLimit)
        ? Math.min(MAX_ENTRY_INTERVAL_LIMIT, Math.max(0, Math.floor(rawLimit)))
        : DEFAULT_ENTRY_INTERVAL_LIMIT,
  }
}

export function buildLedgerEntryResponse(entry, options = {}) {
  if (!entry) return null

  const allIntervals = Array.isArray(entry.ticketIntervals) ? entry.ticketIntervals : []
  const intervalCount = allIntervals.length
  const includeIntervals = Boolean(options.includeIntervals)
  const intervalOffset = includeIntervals ? Math.min(Number(options.intervalOffset || 0), intervalCount) : 0
  const intervalLimit = options.intervalLimit === 'all' ? intervalCount : Number(options.intervalLimit || DEFAULT_ENTRY_INTERVAL_LIMIT)
  const boundedLimit =
    options.intervalLimit === 'all' ? intervalCount : Math.min(MAX_ENTRY_INTERVAL_LIMIT, Math.max(0, Math.floor(intervalLimit)))
  const ticketIntervals = includeIntervals ? allIntervals.slice(intervalOffset, intervalOffset + boundedLimit) : []

  return {
    ...entry,
    ticketIntervals,
    ticketIntervalCount: intervalCount,
    ticketIntervalsOffset: intervalOffset,
    ticketIntervalsLimit: includeIntervals ? boundedLimit : 0,
    ticketIntervalsComplete: intervalOffset + ticketIntervals.length >= intervalCount,
  }
}
