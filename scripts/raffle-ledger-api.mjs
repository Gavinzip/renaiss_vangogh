import { readFileSync, statSync } from 'node:fs'
import { identityForAddress } from './identity-lookup.mjs'

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

export function buildLedgerSummary(ledger, identityIndex = null) {
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
    leaderboardEntries: buildLeaderboardEntries(ledger, SUMMARY_LEADERBOARD_LIMIT, identityIndex),
    notes: Array.isArray(ledger.notes) ? ledger.notes : [],
  }
}

function identityName(identity) {
  return identity?.username || identity?.linkedTwitter || identity?.linkedDiscord || ''
}

function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

function entryAddresses(entry) {
  return [
    entry?.userAddress,
    ...(Array.isArray(entry?.sourceAddresses) ? entry.sourceAddresses : []),
  ].map(normalizeAddress).filter(Boolean)
}

function findEntryIdentity(entry, identityIndex) {
  if (!identityIndex) return { identity: null, identityAddress: null }
  const addresses = entryAddresses(entry)

  for (const address of addresses) {
    const identity = identityForAddress(identityIndex, address)
    if (identityName(identity)) {
      return {
        identity,
        identityAddress: address,
      }
    }
  }

  return { identity: null, identityAddress: null }
}

function buildLeaderboardEntries(ledger, limit, identityIndex = null) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  return entries.slice(0, limit).map((entry, index) => {
    const resolvedIdentity = findEntryIdentity(entry, identityIndex)
    return {
      rank: Number(entry.rank || index + 1),
      userAddress: entry.userAddress || '',
      sourceAddresses: Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [],
      rawTickets: Number(entry.rawTickets || 0),
      bonusTickets: Number(entry.bonusTickets || 0),
      finalTickets: Number(entry.finalTickets || 0),
      sbt: entry.sbt || 'none',
      sbtMultiplier: Number(entry.sbtMultiplier || 1),
      eventCount: Number(entry.eventCount || 0),
      identity: resolvedIdentity.identity,
      identityAddress: resolvedIdentity.identityAddress,
    }
  })
}

export function buildParticipantIdentities(ledger, identityIndex = null) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  const identities = {}

  for (const entry of entries) {
    const addresses = entryAddresses(entry)
    if (!addresses.length) continue

    const entryIdentity = findEntryIdentity(entry, identityIndex)
    if (!entryIdentity.identity) continue

    for (const address of addresses) {
      const directIdentity = identityForAddress(identityIndex, address)
      identities[address] = identityName(directIdentity) ? directIdentity : entryIdentity.identity
    }
  }

  return {
    meta: {
      generatedAt: Number(ledger.generatedAt || 0),
      ledgerHash: ledger.ledgerHash || null,
      totalEntries: Number(ledger.totalEntries || entries.length || 0),
      identityCount: Object.keys(identities).length,
    },
    identities,
  }
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

function ticketNumber(value) {
  const number = Number(value || 0)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

export function parseWinnerTicketQuery(searchParams) {
  const rawTickets = String(searchParams.get('tickets') || '')
  return rawTickets
    .split(',')
    .map((item) => {
      const [rawSlotIndex, rawTicket] = item.split(':')
      const slotIndex = Number(rawSlotIndex)
      const ticket = ticketNumber(rawTicket)
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || !ticket) return null
      return { slotIndex, ticket }
    })
    .filter(Boolean)
}

function ticketIntervalsForTicket(entry, ticket) {
  const intervals = Array.isArray(entry?.ticketIntervals) ? entry.ticketIntervals : []
  return intervals.filter((interval) => {
    const start = ticketNumber(interval?.start)
    const end = ticketNumber(interval?.end)
    return start > 0 && end >= start && ticket >= start && ticket <= end
  })
}

export function findLedgerEntryByTicket(ledger, ticket) {
  if (!ticket || !Array.isArray(ledger.entries)) return null
  return ledger.entries.find((entry) => ticketIntervalsForTicket(entry, ticket).length > 0) || null
}

export function buildDrawWinnerLookupLedger(ledger, winnerTickets) {
  const entriesByAddress = new Map()

  for (const winner of Array.isArray(winnerTickets) ? winnerTickets : []) {
    const ticket = ticketNumber(winner?.ticket)
    if (!ticket) continue
    const entry = findLedgerEntryByTicket(ledger, ticket)
    if (!entry?.userAddress) continue

    const addressKey = String(entry.userAddress).toLowerCase()
    const existing = entriesByAddress.get(addressKey)
    const ticketIntervals = ticketIntervalsForTicket(entry, ticket)
    if (existing) {
      existing.ticketIntervals = [...existing.ticketIntervals, ...ticketIntervals]
      continue
    }

    entriesByAddress.set(addressKey, {
      ...entry,
      ticketIntervals,
    })
  }

  const entries = Array.from(entriesByAddress.values()).map((entry) => ({
    ...entry,
    ticketIntervals: Array.from(
      new Map(
        entry.ticketIntervals.map((interval) => [
          [
            interval.start,
            interval.end,
            interval.namespace || '',
            interval.source || '',
            interval.pack || '',
            interval.txHash || '',
          ].join(':'),
          interval,
        ]),
      ).values(),
    ),
  }))

  return {
    ...buildLedgerSummary(ledger),
    entries,
  }
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
