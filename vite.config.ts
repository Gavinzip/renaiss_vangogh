import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { ServerResponse } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

let devLedgerCache: { ledger: unknown; mtimeMs: number } | null = null

function readDevLedger() {
  const ledgerPath = resolve(process.cwd(), 'public/lucky-draw-ledger.json')
  const stat = statSync(ledgerPath)
  if (devLedgerCache && devLedgerCache.mtimeMs === stat.mtimeMs) return devLedgerCache.ledger

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>
  devLedgerCache = { ledger, mtimeMs: stat.mtimeMs }
  return ledger
}

function devLedgerSummary(ledger: Record<string, unknown>) {
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
    notes: Array.isArray(ledger.notes) ? ledger.notes : [],
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
        if (url.pathname !== '/api/raffle-summary' && url.pathname !== '/api/raffle-entry') {
          next()
          return
        }

        try {
          const ledger = readDevLedger() as Record<string, unknown>
          if (url.pathname === '/api/raffle-summary') {
            sendDevJson(response, 200, devLedgerSummary(ledger))
            return
          }

          const walletQuery = url.searchParams.get('wallet') || ''
          if (!walletQuery.trim()) {
            sendDevJson(response, 400, { entry: null, error: 'wallet query is required' })
            return
          }
          sendDevJson(response, 200, { entry: devFindEntry(ledger, walletQuery) })
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
