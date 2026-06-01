import { buildLedgerFromOpenMonitor, normalizeLoadedLedger } from './ledger'
import type { OpenMonitorLuckyDrawResponse, RaffleLedger } from './types'

const LOCAL_LEDGER_URL = '/lucky-draw-ledger.json'
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
  const local = normalizeLoadedLedger(await readJson(LOCAL_LEDGER_URL))
  if (!local) {
    throw new Error('public/lucky-draw-ledger.json is missing or invalid. Generate the buyback ledger before opening the draw console.')
  }
  return local
}

export async function loadOpenMonitorEstimateForAudit(): Promise<RaffleLedger> {
  const remote = (await readJson(OPEN_MONITOR_LUCKY_DRAW_URL)) as OpenMonitorLuckyDrawResponse
  return buildLedgerFromOpenMonitor(remote)
}
