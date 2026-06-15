import { buildLedgerFromOpenMonitor, normalizeLoadedLedger } from './ledger'
import type { IdentitySuggestion } from './identities'
import type { OpenMonitorLuckyDrawResponse, RaffleEntry, RaffleLedger } from './types'

const FULL_LEDGER_URL = import.meta.env.VITE_LEDGER_URL || '/lucky-draw-ledger.json'
const IDENTITY_SUGGESTIONS_URL = '/api/identity-suggestions'
const RAFFLE_ENTRY_URL = '/api/raffle-entry'
const RAFFLE_SUMMARY_URL = '/api/raffle-summary'
const OPEN_MONITOR_LUCKY_DRAW_URL = '/open-monitor-api/lucky-draw/leaderboard'
const SUMMARY_READ_TIMEOUT_MS = 15_000
const FULL_LEDGER_READ_TIMEOUT_MS = 45_000
const ENTRY_READ_TIMEOUT_MS = 15_000

let fullLedgerCache: RaffleLedger | null = null
let fullLedgerCacheKey = ''
let fullLedgerRequest: Promise<RaffleLedger> | null = null
let fullLedgerRequestKey = ''

type RaffleEntryRequestOptions = {
  intervalOffset?: number
  intervalLimit?: number | 'all'
}

type ReadJsonOptions = {
  cache?: RequestCache
  timeoutMs?: number
}

type FullLedgerOptions = {
  force?: boolean
  version?: string
}

function versionedUrl(url: string, version = '') {
  if (!version) return url
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const nextUrl = new URL(url, base)
  nextUrl.searchParams.set('v', version)
  return nextUrl.toString()
}

async function readJson(url: string, options: ReadJsonOptions = {}): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId =
    options.timeoutMs && options.timeoutMs > 0
      ? window.setTimeout(() => controller.abort(), options.timeoutMs)
      : 0

  try {
    const response = await fetch(url, {
      cache: options.cache ?? 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`)
    }
    const text = await response.text()
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${url} timed out while loading raffle data.`, { cause: error })
    }
    throw error
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId)
  }
}

export async function loadRaffleLedger(): Promise<RaffleLedger> {
  const summary = normalizeLoadedLedger(await readJson(RAFFLE_SUMMARY_URL, { timeoutMs: SUMMARY_READ_TIMEOUT_MS }))
  if (!summary) {
    throw new Error('Lucky draw ledger summary is missing or invalid.')
  }
  return summary
}

export async function loadFullRaffleLedger({ force = false, version = '' }: FullLedgerOptions = {}): Promise<RaffleLedger> {
  const requestKey = version || 'current'
  if (!force && fullLedgerCache && fullLedgerCacheKey === requestKey) return fullLedgerCache
  if (!force && fullLedgerRequest && fullLedgerRequestKey === requestKey) return fullLedgerRequest

  fullLedgerRequestKey = requestKey
  fullLedgerRequest = readJson(versionedUrl(FULL_LEDGER_URL, version), {
    cache: force ? 'reload' : 'default',
    timeoutMs: FULL_LEDGER_READ_TIMEOUT_MS,
  })
    .then((payload) => {
      const ledger = normalizeLoadedLedger(payload)
      if (!ledger) {
        throw new Error('public/lucky-draw-ledger.json is missing or invalid. Generate the buyback ledger before opening the draw console.')
      }
      fullLedgerCache = ledger
      fullLedgerCacheKey = requestKey
      return ledger
    })
    .finally(() => {
      fullLedgerRequest = null
      fullLedgerRequestKey = ''
    })

  return fullLedgerRequest
}

export async function loadRaffleEntry(query: string, options: RaffleEntryRequestOptions = {}): Promise<RaffleEntry | null> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  const params = new URLSearchParams({ wallet: normalizedQuery })
  if (typeof options.intervalOffset === 'number') {
    params.set('intervalOffset', String(options.intervalOffset))
  }
  if (options.intervalLimit !== undefined) {
    params.set('intervalLimit', String(options.intervalLimit))
  }

  const payload = (await readJson(`${RAFFLE_ENTRY_URL}?${params.toString()}`, { timeoutMs: ENTRY_READ_TIMEOUT_MS })) as {
    entry?: RaffleEntry | null
  }
  return payload.entry ?? null
}

export async function loadIdentitySuggestions(query: string, limit = 8): Promise<IdentitySuggestion[]> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length < 2) return []

  const params = new URLSearchParams({
    limit: String(limit),
    q: normalizedQuery,
  })
  const payload = (await readJson(`${IDENTITY_SUGGESTIONS_URL}?${params.toString()}`, { timeoutMs: ENTRY_READ_TIMEOUT_MS })) as {
    suggestions?: IdentitySuggestion[]
  }
  return Array.isArray(payload.suggestions) ? payload.suggestions : []
}

export async function loadOpenMonitorEstimateForAudit(): Promise<RaffleLedger> {
  const remote = (await readJson(OPEN_MONITOR_LUCKY_DRAW_URL)) as OpenMonitorLuckyDrawResponse
  return buildLedgerFromOpenMonitor(remote)
}
