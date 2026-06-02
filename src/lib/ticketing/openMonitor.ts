import { buildLedgerFromOpenMonitor, normalizeLoadedLedger } from './ledger'
import type { OpenMonitorLuckyDrawResponse, RaffleEntry, RaffleLedger } from './types'

const FULL_LEDGER_URL = import.meta.env.VITE_LEDGER_URL || '/lucky-draw-ledger.json'
const RAFFLE_ENTRY_URL = '/api/raffle-entry'
const RAFFLE_SUMMARY_URL = '/api/raffle-summary'
const OPEN_MONITOR_LUCKY_DRAW_URL = '/open-monitor-api/lucky-draw/leaderboard'

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

export async function loadFullRaffleLedger(): Promise<RaffleLedger> {
  const ledger = normalizeLoadedLedger(await readJson(FULL_LEDGER_URL))
  if (!ledger) {
    throw new Error('public/lucky-draw-ledger.json is missing or invalid. Generate the buyback ledger before opening the draw console.')
  }
  return ledger
}

export async function loadRaffleEntry(query: string): Promise<RaffleEntry | null> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  const payload = (await readJson(`${RAFFLE_ENTRY_URL}?wallet=${encodeURIComponent(normalizedQuery)}`)) as {
    entry?: RaffleEntry | null
  }
  return payload.entry ?? null
}

export async function loadOpenMonitorEstimateForAudit(): Promise<RaffleLedger> {
  const remote = (await readJson(OPEN_MONITOR_LUCKY_DRAW_URL)) as OpenMonitorLuckyDrawResponse
  return buildLedgerFromOpenMonitor(remote)
}
