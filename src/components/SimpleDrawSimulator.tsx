import { RotateCcw, Shuffle, Ticket, Trophy, UserRound } from 'lucide-react'
import { useState } from 'react'
import { PRIZE_GROUPS, TOTAL_PRIZE_DRAW_SLOTS, prizeGroupForSlot, prizeOrdinalInGroup } from '../lib/draw/prizeSlots'
import type { AppCopy } from '../lib/i18n'
import { compactNumber, formatDrawTicketNumber } from '../lib/ticketing/display'
import type { WalletIdentityMap } from '../lib/ticketing/identities'
import { formatAddress } from '../lib/ticketing/rules'
import type { RaffleLedger } from '../lib/ticketing/types'
import { findWinnerCandidate, type WinnerCandidate } from '../lib/ticketing/winnerCandidates'

interface SimulatedDrawResult {
  id: string
  owner: WinnerCandidate | null
  prizeLabel: string
  prizeOrdinal: number
  ticket: number
}

function randomTicket(totalTickets: number): number {
  return Math.floor(Math.random() * Math.max(1, totalTickets)) + 1
}

function randomUniqueTickets(totalTickets: number, count: number): number[] {
  const tickets = new Set<number>()
  const limit = Math.min(Math.max(1, totalTickets), count)
  while (tickets.size < limit) {
    tickets.add(randomTicket(totalTickets))
  }
  return [...tickets]
}

function resultWalletLabel(result: SimulatedDrawResult, copy: AppCopy): string {
  return result.owner?.displayName || result.owner?.address || copy.simulation.noWinner
}

export function SimpleDrawSimulator({
  ledger,
  walletIdentities,
  copy,
}: {
  ledger: RaffleLedger
  walletIdentities: WalletIdentityMap
  copy: AppCopy
}) {
  const [results, setResults] = useState<SimulatedDrawResult[]>([])
  const latestResult = results[0] ?? null

  function runSimulation() {
    const timestamp = Date.now()
    const tickets = randomUniqueTickets(ledger.totalFinalTickets, TOTAL_PRIZE_DRAW_SLOTS)
    const nextResults = tickets.map((ticket, slotIndex) => {
      const prizeGroup = prizeGroupForSlot(slotIndex)
      const owner = findWinnerCandidate({
        winnerTicket: BigInt(ticket),
        ledger,
        identities: walletIdentities,
      })

      return {
        id: `${timestamp}-${ticket}-${slotIndex}`,
        owner,
        prizeLabel: prizeGroup.label,
        prizeOrdinal: prizeOrdinalInGroup(slotIndex),
        ticket,
      }
    })
    setResults(nextResults)
  }

  return (
    <section className="page-grid simulator-page">
      <section className="panel simulator-control-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{copy.simulation.simpleMode}</span>
            <h2>{copy.simulation.panelTitle}</h2>
            <p>{copy.simulation.notice}</p>
          </div>
          <Shuffle size={24} />
        </div>

        <div className="simulator-next-prize">
          <span>{copy.rules.prizeAllocation}</span>
          <strong>
            {TOTAL_PRIZE_DRAW_SLOTS} {copy.rules.winners}
          </strong>
          <small>
            {PRIZE_GROUPS.map((group) => `${group.label} x${group.slotCount}`).join(' / ')}
          </small>
        </div>

        <div className="simulator-actions">
          <button className="btn btn-main simulator-run-button" type="button" onClick={runSimulation}>
            <Ticket size={18} />
            <span>{copy.simulation.run}</span>
          </button>
          <button className="icon-button simulator-reset-button" type="button" onClick={() => setResults([])} disabled={!results.length}>
            <RotateCcw size={18} />
            <span>{copy.simulation.reset}</span>
          </button>
        </div>

        <div className="simulator-prize-list" aria-label={copy.rules.prizeAllocation}>
          {PRIZE_GROUPS.map((group) => (
            <div key={group.id}>
              <span>{group.label}</span>
              <strong>{group.slotCount}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel simulator-result-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{copy.simulation.resultEyebrow}</span>
            <h2>{copy.simulation.resultTitle}</h2>
          </div>
          <Trophy size={24} />
        </div>

        {latestResult ? (
          <div className="simulator-latest-result">
            <div>
              <span>{copy.simulation.ticket}</span>
              <strong>#{formatDrawTicketNumber(latestResult.ticket, ledger.totalFinalTickets)}</strong>
            </div>
            <div>
              <span>{copy.simulation.prize}</span>
              <strong>
                {latestResult.prizeLabel} #{latestResult.prizeOrdinal}
              </strong>
            </div>
            <div>
              <span>{copy.simulation.wallet}</span>
              <strong>{resultWalletLabel(latestResult, copy)}</strong>
              {latestResult.owner && <small>{formatAddress(latestResult.owner.address)}</small>}
            </div>
          </div>
        ) : (
          <div className="simulator-empty">
            <UserRound size={26} />
            <span>{copy.simulation.noResults}</span>
          </div>
        )}

        <div className="simulator-history">
          <div className="simulator-history-head">
            <span>{copy.simulation.recentResults}</span>
            <strong>
              {compactNumber(results.length)} / {TOTAL_PRIZE_DRAW_SLOTS}
            </strong>
          </div>
          {results.length ? (
            <div className="simulator-history-list">
              {results.map((result) => (
                <article key={result.id} className="simulator-history-row">
                  <span>#{formatDrawTicketNumber(result.ticket, ledger.totalFinalTickets)}</span>
                  <strong>{resultWalletLabel(result, copy)}</strong>
                  <small>{result.prizeLabel}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="simulator-history-empty">{copy.simulation.emptyHistory}</p>
          )}
        </div>
      </section>
    </section>
  )
}
