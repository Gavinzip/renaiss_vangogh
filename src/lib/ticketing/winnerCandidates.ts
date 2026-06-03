import type { RaffleEntry, RaffleLedger, TicketInterval } from './types'
import type { WalletIdentityMap } from './identities'
import { shortenAddress } from './identities'
import { formatDrawTicketNumber } from './display'

const MAX_SAMPLE_TICKETS = 10
const MAX_VISIBLE_CANDIDATES = 12

export interface WinnerCandidate {
  address: string
  displayName: string
  matchingTickets: number
  sampleTickets: number[]
  entry: RaffleEntry
}

export interface WinnerCandidateSnapshot {
  prefix: string
  rangeStart: number
  rangeEnd: number
  possibleTicketCount: number
  possibleOwnerCount: number
  visibleCandidates: WinnerCandidate[]
}

function overlap(interval: TicketInterval, start: number, end: number) {
  const from = Math.max(interval.start, start)
  const to = Math.min(interval.end, end)
  return from <= to ? { from, to, count: to - from + 1 } : null
}

function identityName(entry: RaffleEntry, identities: WalletIdentityMap): string {
  const addresses = [entry.userAddress, ...entry.sourceAddresses]
  for (const address of addresses) {
    const username = identities[address.toLowerCase()]?.username
    if (username) return username
  }
  return shortenAddress(entry.userAddress)
}

function candidateRange(winnerTicket: bigint, revealedDigitCount: number, totalTickets: number) {
  const ticketNumber = formatDrawTicketNumber(winnerTicket, totalTickets)
  const prefix = ticketNumber.slice(0, revealedDigitCount)
  if (!prefix) return null

  const remainingDigits = ticketNumber.length - prefix.length
  const scale = 10 ** remainingDigits
  const rangeStart = Math.max(1, Number(prefix) * scale)
  const rangeEnd = Math.min(Number(prefix) * scale + scale - 1, totalTickets)

  if (!Number.isSafeInteger(rangeStart) || rangeStart < 1 || rangeStart > totalTickets || rangeEnd < rangeStart) {
    return null
  }

  return {
    prefix,
    rangeStart,
    rangeEnd,
    possibleTicketCount: rangeEnd - rangeStart + 1,
  }
}

export function buildWinnerCandidateSnapshot({
  winnerTicket,
  revealedDigitCount,
  ledger,
  identities,
}: {
  winnerTicket: bigint | null
  revealedDigitCount: number
  ledger: RaffleLedger
  identities: WalletIdentityMap
}): WinnerCandidateSnapshot | null {
  if (!winnerTicket || revealedDigitCount <= 0) return null

  const range = candidateRange(winnerTicket, revealedDigitCount, ledger.totalFinalTickets)
  if (!range) return null

  const candidates: WinnerCandidate[] = []

  for (const entry of ledger.entries) {
    let matchingTickets = 0
    const sampleTickets: number[] = []

    for (const interval of entry.ticketIntervals) {
      const match = overlap(interval, range.rangeStart, range.rangeEnd)
      if (!match) continue
      matchingTickets += match.count

      for (let ticket = match.from; ticket <= match.to && sampleTickets.length < MAX_SAMPLE_TICKETS; ticket += 1) {
        sampleTickets.push(ticket)
      }
    }

    if (matchingTickets > 0) {
      candidates.push({
        address: entry.userAddress,
        displayName: identityName(entry, identities),
        matchingTickets,
        sampleTickets,
        entry,
      })
    }
  }

  candidates.sort((a, b) => b.matchingTickets - a.matchingTickets || b.entry.finalTickets - a.entry.finalTickets)

  return {
    ...range,
    possibleOwnerCount: candidates.length,
    visibleCandidates: candidates.slice(0, MAX_VISIBLE_CANDIDATES),
  }
}

export function findWinnerCandidate({
  winnerTicket,
  ledger,
  identities,
}: {
  winnerTicket: bigint
  ledger: RaffleLedger
  identities: WalletIdentityMap
}): WinnerCandidate | null {
  const snapshot = buildWinnerCandidateSnapshot({
    winnerTicket,
    revealedDigitCount: formatDrawTicketNumber(winnerTicket, ledger.totalFinalTickets).length,
    ledger,
    identities,
  })

  return snapshot?.visibleCandidates[0] ?? null
}
