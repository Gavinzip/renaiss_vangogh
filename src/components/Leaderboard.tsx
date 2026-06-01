import { ArrowUpRight, Search } from 'lucide-react'
import type { RaffleEntry, RaffleLedger } from '../lib/ticketing/types'
import { formatAddress, formatSbtTier } from '../lib/ticketing/rules'
import { compactNumber, entryRange } from '../lib/ticketing/display'

export function Leaderboard({
  entries,
  query,
  setQuery,
  ledger,
}: {
  entries: RaffleEntry[]
  query: string
  setQuery: (value: string) => void
  ledger: RaffleLedger
}) {
  return (
    <section className="panel leaderboard">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Participants</span>
          <h2>Ticket accounting</h2>
        </div>
        <a
          className="ghost-link"
          href="https://open-monitor-rmrm.pages.dev/lucky-draw"
          target="_blank"
          rel="noreferrer"
        >
          Source <ArrowUpRight size={16} />
        </a>
      </div>

      <label className="search-box">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search wallet"
          spellCheck={false}
        />
      </label>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Wallet</th>
              <th>Raw</th>
              <th>SBT tier</th>
              <th>Final</th>
              <th>Ticket range</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.userAddress}>
                <td>#{entry.rank}</td>
                <td>{formatAddress(entry.userAddress)}</td>
                <td>{compactNumber(entry.rawTickets)}</td>
                <td>{formatSbtTier(entry.sbt, entry.sbtMultiplier)}</td>
                <td>{compactNumber(entry.finalTickets)}</td>
                <td>{entryRange(entry, ledger.mode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
