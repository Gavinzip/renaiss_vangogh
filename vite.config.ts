import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { ServerResponse } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { identityForAddress, readIdentityIndex, resolveIdentityQuery, suggestIdentityQueries } from './scripts/identity-lookup.mjs'

let devLedgerCache: { ledger: unknown; mtimeMs: number } | null = null
const DEFAULT_ENTRY_INTERVAL_LIMIT = 0
const MAX_ENTRY_INTERVAL_LIMIT = 240
const SUMMARY_LEADERBOARD_LIMIT = 10
const IDENTITY_LOOKUP_PATH = resolve(process.cwd(), 'public/lucky-draw-identities.json')

function readDevLedger() {
  const ledgerPath = resolve(process.cwd(), 'public/lucky-draw-ledger.json')
  const stat = statSync(ledgerPath)
  if (devLedgerCache && devLedgerCache.mtimeMs === stat.mtimeMs) return devLedgerCache.ledger

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>
  devLedgerCache = { ledger, mtimeMs: stat.mtimeMs }
  return ledger
}

function devIdentityName(identity: { username?: string | null; linkedTwitter?: string | null; linkedDiscord?: string | null } | null) {
  return identity?.username || identity?.linkedTwitter || identity?.linkedDiscord || ''
}

function devNormalizeAddress(value: unknown) {
  const address = String(value || '').trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(address) ? address : ''
}

function devEntryAddresses(entry: Record<string, unknown>) {
  return [
    entry.userAddress,
    ...(Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : []),
  ].map(devNormalizeAddress).filter(Boolean)
}

function devFindLeaderboardIdentity(entry: Record<string, unknown>, identityIndex: ReturnType<typeof readIdentityIndex>) {
  if (!identityIndex) return { identity: null, identityAddress: null }
  const addresses = devEntryAddresses(entry)

  for (const address of addresses) {
    const identity = identityForAddress(identityIndex, address)
    if (devIdentityName(identity)) {
      return {
        identity,
        identityAddress: address,
      }
    }
  }

  return { identity: null, identityAddress: null }
}

function devLedgerSummary(ledger: Record<string, unknown>, identityIndex: ReturnType<typeof readIdentityIndex>) {
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
    entries: [],
    leaderboardEntries: devBuildLeaderboardEntries(ledger, identityIndex),
    notes: Array.isArray(ledger.notes) ? ledger.notes : [],
  }
}

function devBuildLeaderboardEntries(ledger: Record<string, unknown>, identityIndex: ReturnType<typeof readIdentityIndex>) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  return entries.slice(0, SUMMARY_LEADERBOARD_LIMIT).map((value, index) => {
    const entry = value as Record<string, unknown>
    const resolvedIdentity = devFindLeaderboardIdentity(entry, identityIndex)
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

function devBuildParticipantIdentities(ledger: Record<string, unknown>, identityIndex: ReturnType<typeof readIdentityIndex>) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  const identities: Record<string, { username: string | null; linkedTwitter: string | null; linkedDiscord: string | null }> = {}

  for (const value of entries) {
    const entry = value as Record<string, unknown>
    const addresses = devEntryAddresses(entry)
    if (addresses.length === 0) continue

    const entryIdentity = devFindLeaderboardIdentity(entry, identityIndex)
    if (!entryIdentity.identity) continue

    for (const address of addresses) {
      const directIdentity = identityForAddress(identityIndex, address)
      const resolvedIdentity = directIdentity && devIdentityName(directIdentity) ? directIdentity : entryIdentity.identity
      if (resolvedIdentity) identities[address] = resolvedIdentity
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

function devFindEntry(ledger: Record<string, unknown>, query: string) {
  const normalized = query.trim().toLowerCase()
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  if (!normalized) return null

  return entries.find((value) => {
    const entry = value as { sourceAddresses?: unknown[]; userAddress?: unknown }
    const addresses = [entry.userAddress, ...(Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [])]
    return addresses.some((address) => String(address || '').toLowerCase().includes(normalized))
  }) ?? null
}

function devFindEntryByAddresses(ledger: Record<string, unknown>, addresses: string[]) {
  const normalizedAddresses = new Set(addresses.map((address) => String(address || '').toLowerCase()).filter(Boolean))
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  if (!normalizedAddresses.size) return null

  return (
    entries.find((value) => {
      const entry = value as { sourceAddresses?: unknown[]; userAddress?: unknown }
      const entryAddresses = [entry.userAddress, ...(Array.isArray(entry.sourceAddresses) ? entry.sourceAddresses : [])]
      return entryAddresses.some((address) => normalizedAddresses.has(String(address || '').toLowerCase()))
    }) ?? null
  )
}

function devParseEntryIntervalQuery(searchParams: URLSearchParams) {
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

function devBuildEntryResponse(entry: unknown, options: ReturnType<typeof devParseEntryIntervalQuery>) {
  if (!entry || typeof entry !== 'object') return null

  const value = entry as Record<string, unknown>
  const allIntervals = Array.isArray(value.ticketIntervals) ? value.ticketIntervals : []
  const intervalCount = allIntervals.length
  const intervalOffset = options.includeIntervals ? Math.min(options.intervalOffset, intervalCount) : 0
  const intervalLimit =
    options.intervalLimit === 'all'
      ? intervalCount
      : Math.min(MAX_ENTRY_INTERVAL_LIMIT, Math.max(0, Math.floor(Number(options.intervalLimit))))
  const ticketIntervals = options.includeIntervals ? allIntervals.slice(intervalOffset, intervalOffset + intervalLimit) : []

  return {
    ...value,
    ticketIntervals,
    ticketIntervalCount: intervalCount,
    ticketIntervalsOffset: intervalOffset,
    ticketIntervalsLimit: options.includeIntervals ? intervalLimit : 0,
    ticketIntervalsComplete: intervalOffset + ticketIntervals.length >= intervalCount,
  }
}

function sendDevJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

function raffleApiDevPlugin(): Plugin {
  return {
    name: 'raffle-api-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost')
        if (
          url.pathname !== '/api/raffle-summary' &&
          url.pathname !== '/api/participant-identities' &&
          url.pathname !== '/api/raffle-entry' &&
          url.pathname !== '/api/identity-suggestions'
        ) {
          next()
          return
        }

        try {
          const identityIndex = readIdentityIndex(IDENTITY_LOOKUP_PATH)
          if (url.pathname === '/api/identity-suggestions') {
            sendDevJson(response, 200, {
              suggestions: suggestIdentityQueries(identityIndex, url.searchParams.get('q') || '', Number(url.searchParams.get('limit') || 8)),
            })
            return
          }

          const ledger = readDevLedger() as Record<string, unknown>
          if (url.pathname === '/api/raffle-summary') {
            sendDevJson(response, 200, devLedgerSummary(ledger, identityIndex))
            return
          }

          if (url.pathname === '/api/participant-identities') {
            sendDevJson(response, 200, devBuildParticipantIdentities(ledger, identityIndex))
            return
          }

          const walletQuery = url.searchParams.get('wallet') || ''
          if (!walletQuery.trim()) {
            sendDevJson(response, 400, { entry: null, error: 'wallet query is required' })
            return
          }
          const identityResolution = resolveIdentityQuery(identityIndex, walletQuery)
          const directEntry = devFindEntry(ledger, walletQuery)
          const identityEntry = directEntry ? null : devFindEntryByAddresses(ledger, identityResolution?.addresses ?? [])
          sendDevJson(response, 200, {
            entry: devBuildEntryResponse(directEntry || identityEntry, devParseEntryIntervalQuery(url.searchParams)),
            lookup: identityResolution
              ? {
                  kind: identityResolution.kind,
                  query: identityResolution.query,
                  addressCount: identityResolution.addresses.length,
                  matchedLedger: Boolean(directEntry || identityEntry),
                  identity: identityResolution.identity,
                }
              : null,
          })
        } catch (error) {
          sendDevJson(response, 503, {
            error: error instanceof Error ? error.message : 'Could not read lucky draw ledger.',
          })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), raffleApiDevPlugin()],
  server: {
    proxy: {
      '/open-monitor-api': {
        target: 'https://open-monitor-rmrm.pages.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/open-monitor-api/, '/api'),
      },
    },
  },
})
