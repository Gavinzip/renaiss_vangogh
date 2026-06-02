import { readFileSync, statSync } from 'node:fs'

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
    entries: [],
    notes: Array.isArray(ledger.notes) ? ledger.notes : [],
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
