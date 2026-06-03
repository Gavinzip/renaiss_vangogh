import { buildLedgerFromOpenMonitor, normalizeLoadedLedger } from './ledger'
import type { IdentitySuggestion } from './identities'
import type { OpenMonitorLuckyDrawResponse, RaffleEntry, RaffleLedger } from './types'

const FULL_LEDGER_URL = import.meta.env.VITE_LEDGER_URL || '/lucky-draw-ledger.json'
const IDENTITY_SUGGESTIONS_URL = '/api/identity-suggestions'
const RAFFLE_ENTRY_URL = '/api/raffle-entry'
const RAFFLE_SUMMARY_URL = '/api/raffle-summary'
const OPEN_MONITOR_LUCKY_DRAW_URL = '/open-monitor-api/lucky-draw/leaderboard'

let fullLedgerCache: RaffleLedger | null = null
let fullLedgerRequest: Promise<RaffleLedger> | null = null

type RaffleEntryRequestOptions = {
  intervalOffset?: number
  intervalLimit?: number | 'all'
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }
  const text = await response.text()
  return JSON.parse(text)
}

export async function loadRaffleLedger(): Promise<RaffleLedger> {
  const summary = normalizeLoadedLedger(await readJson(RAFFLE_SUMMARY_URL))
  if (!summary) {
    throw new Error('Lucky draw ledger summary is missing or invalid.')
  }
  return summary
}

export async function loadFullRaffleLedger({ force = false }: { force?: boolean } = {}): Promise<RaffleLedger> {
  if (!force && fullLedgerCache) return fullLedgerCache
  if (!force && fullLedgerRequest) return fullLedgerRequest

  fullLedgerRequest = readJson(FULL_LEDGER_URL)
    .then((payload) => {
      const ledger = normalizeLoadedLedger(payload)
      if (!ledger) {
        throw new Error('public/lucky-draw-ledger.json is missing or invalid. Generate the buyback ledger before opening the draw console.')
      }
      fullLedgerCache = ledger
      return ledger
    })
    .finally(() => {
      fullLedgerRequest = null
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

  const payload = (await readJson(`${RAFFLE_ENTRY_URL}?${params.toString()}`)) as {
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
  const payload = (await readJson(`${IDENTITY_SUGGESTIONS_URL}?${params.toString()}`)) as {
    suggestions?: IdentitySuggestion[]
  }
  return Array.isArray(payload.suggestions) ? payload.suggestions : []
}

export async function loadOpenMonitorEstimateForAudit(): Promise<RaffleLedger> {
  const remote = (await readJson(OPEN_MONITOR_LUCKY_DRAW_URL)) as OpenMonitorLuckyDrawResponse
  return buildLedgerFromOpenMonitor(remote)
}
