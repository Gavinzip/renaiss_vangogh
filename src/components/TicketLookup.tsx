import { AlertTriangle, Copy, Search, Ticket, Trophy, Wallet } from 'lucide-react'
import type { RaffleEntry, RaffleLedger } from '../lib/ticketing/types'
import { formatAddress, formatSbtTier, formatTicketRange, PACK_LABELS, PACK_WEIGHTS } from '../lib/ticketing/rules'
import {
  anyPrizeProbability,
  compactNumber,
  entryRange,
  intervalLabel,
  percent,
  probability,
} from '../lib/ticketing/display'
import { CASH_PRIZE_POOL } from '../lib/prizes/prizes'

export function TicketLookup({
  entry,
  ledger,
  query,
  setQuery,
  connectedAddress,
}: {
  entry: RaffleEntry | null
  ledger: RaffleLedger
  query: string
  setQuery: (value: string) => void
  connectedAddress?: string
}) {
  const grandPrizeOdds = probability(entry, ledger.totalFinalTickets)
  const anyPrizeOdds = anyPrizeProbability(entry, ledger.totalFinalTickets)
  const expectedCash = grandPrizeOdds * CASH_PRIZE_POOL
  const intervals = entry?.ticketIntervals ?? []
  const rawIntervals = intervals.filter((interval) => interval.namespace !== 'bonus' && interval.source !== 'sbt-bonus')
  const bonusIntervals = intervals.filter((interval) => interval.namespace === 'bonus' || interval.source === 'sbt-bonus')

  async function copyTickets() {
    if (!entry || intervals.length === 0) return
    const text = intervals.map(intervalLabel).join('\n')
    await navigator.clipboard.writeText(text)
  }

  return (
    <section className="page-grid lookup-page">
      <section className="panel lookup-search">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">My tickets</span>
            <h2>Search wallet ticket numbers</h2>
          </div>
          <Ticket size={22} />
        </div>

        <div className="lookup-form">
          <label className="search-box large">
            <Search size={18} />
            <input
              data-ticket-search="true"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Paste BSC wallet address"
              spellCheck={false}
            />
          </label>
          <button className="primary" type="button" onClick={() => setQuery(query.trim())}>
            <Search size={18} />
            Search
          </button>
        </div>

        {connectedAddress && (
          <button className="wallet-query-button" type="button" onClick={() => setQuery(connectedAddress)}>
            <Wallet size={17} />
            Use connected wallet
          </button>
        )}

        {ledger.mode !== 'buyback-ledger' && (
          <div className="notice inline">
            <AlertTriangle size={18} />
              <span>
                Exact ticket numbers need the buyback ledger. Estimate mode only shows likely totals.
              </span>
          </div>
        )}

        {entry ? (
          <div className="ticket-summary">
            <div>
              <span>Wallet</span>
              <strong>{formatAddress(entry.userAddress)}</strong>
            </div>
            <div>
              <span>Ticket numbers</span>
              <strong>{entryRange(entry, ledger.mode)}</strong>
            </div>
            <div>
              <span>Raw tickets</span>
              <strong>{compactNumber(entry.rawTickets)}</strong>
            </div>
            <div>
              <span>Bonus tickets</span>
              <strong>{compactNumber(entry.bonusTickets)}</strong>
            </div>
            <div>
              <span>SBT</span>
              <strong>{formatSbtTier(entry.sbt, entry.sbtMultiplier)}</strong>
            </div>
            <div>
              <span>Final tickets</span>
              <strong>{compactNumber(entry.finalTickets)}</strong>
            </div>
            <div>
              <span>Any prize odds</span>
              <strong>{percent(anyPrizeOdds)}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Enter a wallet address to see its tickets.</div>
        )}
      </section>

      <section className="panel ticket-ranges">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Assigned numbers</span>
            <h2>Buyback order ranges</h2>
          </div>
          <button className="icon-button" onClick={copyTickets} disabled={intervals.length === 0}>
            <Copy size={18} />
          </button>
        </div>

        {entry && ledger.mode === 'buyback-ledger' && intervals.length > 0 ? (
          <div className="interval-list">
            {rawIntervals.length > 0 && (
              <div className="interval-group">
                <div className="interval-group-heading">
                  <span>Raw ticket numbers</span>
                  <strong>{compactNumber(entry.rawTickets)} R</strong>
                </div>
                {rawIntervals.slice(0, 120).map((interval, index) => (
                  <article className="interval-row" key={`${interval.start}-${interval.end}-${index}`}>
                    <div>
                      <strong>{intervalLabel(interval)}</strong>
                      <span>
                        {interval.pack ? `${PACK_LABELS[interval.pack]} buyback` : 'Multiplier bonus'}
                        {interval.txHash ? ` · ${interval.txHash.slice(0, 10)}...${interval.txHash.slice(-6)}` : ''}
                      </span>
                    </div>
                    <span>{interval.timestamp ? new Date(interval.timestamp * 1000).toLocaleString() : ''}</span>
                  </article>
                ))}
              </div>
            )}
            {bonusIntervals.length > 0 && (
              <div className="interval-group interval-group--bonus">
                <div className="interval-group-heading">
                  <span>SBT bonus numbers</span>
                  <strong>{compactNumber(entry.bonusTickets)} B</strong>
                </div>
                <p className="bonus-provisional-note">Bonus numbers are provisional until the final ledger is locked.</p>
                {bonusIntervals.slice(0, 120).map((interval, index) => (
                  <article className="interval-row interval-row--bonus" key={`${interval.start}-${interval.end}-${index}`}>
                    <div>
                      <strong>{intervalLabel(interval)}</strong>
                      <span>Global draw number {formatTicketRange(interval.start, interval.end)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {intervals.length > 120 && (
              <p className="soft-copy">Showing first 120 ranges. Export the ledger JSON for the full list.</p>
            )}
          </div>
        ) : (
          <div className="empty-state">
            Enter a wallet address to see exact ticket ranges.
          </div>
        )}
      </section>

      <section className="panel entry-detail compact-detail">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Odds</span>
            <h2>Prize probability</h2>
          </div>
          <Trophy size={22} />
        </div>
        <div className="probability-row">
          <div>
            <span>Grand prize odds</span>
            <strong>{percent(grandPrizeOdds)}</strong>
          </div>
          <div>
            <span>Any of 21 prizes</span>
            <strong>{percent(anyPrizeOdds)}</strong>
          </div>
          <div>
            <span>Expected cash share</span>
            <strong>{expectedCash.toFixed(2)} USDT</strong>
          </div>
        </div>
        {entry && (
          <div className="pack-strip">
            {Object.entries(PACK_LABELS).map(([key, label]) => (
              <div key={key}>
                <span>{label}</span>
                <strong>
                  {compactNumber(entry.packs[key as keyof typeof PACK_LABELS])}
                  <small> x{PACK_WEIGHTS[key as keyof typeof PACK_LABELS]}</small>
                </strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
