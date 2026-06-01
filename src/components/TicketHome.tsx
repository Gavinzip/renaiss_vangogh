import { useState } from 'react'
import { Copy, Gem, Hash, Search, ShieldCheck, Sparkles, Ticket, Trophy } from 'lucide-react'
import sbtBrownImage from '../assets/sbt-brown.png'
import sbtGoldImage from '../assets/sbt-gold.png'
import sbtRainbowImage from '../assets/sbt-rainbow.png'
import sbtSilverImage from '../assets/sbt-silver.png'
import sbtLevelsImage from '../assets/van-gogh-sbt-levels-source.jpeg'
import type { AppCopy, LanguageCode } from '../lib/i18n'
import { packLabel } from '../lib/i18n'
import { anyPrizeProbability, compactNumber, intervalLabel, percent, probability } from '../lib/ticketing/display'
import { formatAddress, PACK_LABELS, PACK_WEIGHTS } from '../lib/ticketing/rules'
import type { RaffleEntry, RaffleLedger, SbtTier, TicketInterval } from '../lib/ticketing/types'
import { HoloPrizeCard } from './HoloPrizeCard'
import { RollingReveal } from './RollingReveal'

const SBT_TIER_IMAGES: Partial<Record<SbtTier, string>> = {
  brown: sbtBrownImage,
  silver: sbtSilverImage,
  gold: sbtGoldImage,
  rainbow: sbtRainbowImage,
}

function bscTxUrl(txHash: string): string {
  return `https://bscscan.com/tx/${encodeURIComponent(txHash)}`
}

function intervalEventText(interval: TicketInterval, copy: AppCopy): string {
  if (!interval.pack) return copy.ticketHome.bonus
  return `${packLabel(interval.pack, copy)} ${copy.ticketHome.buybackSuffix}`
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some embedded browser surfaces block the async Clipboard API.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('copy command failed')
}

function formatRefreshTime(value: number, language: LanguageCode) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function TicketHome({
  ledger,
  entry,
  query,
  setQuery,
  connectedAddress,
  copy,
  language,
  lastLedgerRefreshAt,
  nextLedgerRefreshAt,
}: {
  ledger: RaffleLedger
  entry: RaffleEntry | null
  query: string
  setQuery: (value: string) => void
  connectedAddress?: string
  copy: AppCopy
  language: LanguageCode
  lastLedgerRefreshAt: number
  nextLedgerRefreshAt: number
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const intervals = entry?.ticketIntervals ?? []
  const grandPrizeOdds = probability(entry, ledger.totalFinalTickets)
  const anyPrizeOdds = anyPrizeProbability(entry, ledger.totalFinalTickets)
  const hasQuery = query.trim().length > 0
  const ledgerHashLabel = ledger.ledgerHash
    ? `${ledger.ledgerHash.slice(0, 8)}...${ledger.ledgerHash.slice(-6)}`
    : copy.common.pending
  const activeSbtImage = entry ? SBT_TIER_IMAGES[entry.sbt] : undefined
  const activeSbtLabel = entry
    ? entry.sbt === 'none'
      ? copy.sbt.tiers.none
      : `${copy.sbt.tiers[entry.sbt]} SBT`
    : copy.ticketHome.sbtMultiplier

  async function copyTickets() {
    if (!entry || intervals.length === 0) return
    const text = intervals
      .map((interval) => {
        const lines = [
          intervalLabel(interval),
          intervalEventText(interval, copy),
          interval.txHash ? `${copy.ticketHome.transactionId}: ${interval.txHash}` : '',
          interval.timestamp ? new Date(interval.timestamp * 1000).toLocaleString(language) : '',
        ].filter(Boolean)
        return lines.join(' · ')
      })
      .join('\n')

    try {
      await writeClipboardText(text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    } finally {
      window.setTimeout(() => setCopyState('idle'), 1800)
    }
  }

  return (
    <>
      <section id="tickets" className="panel hero ticket-home-hero">
        <div className="ticket-search-stage">
          <div className="ticket-headline">
            <span className="chip">
              <Gem size={14} />
              {copy.ticketHome.chainBadge}
            </span>
            <h1>
              <span className="line">{copy.ticketHome.titleVanGogh}</span>
              <span className="line">
                <span className="text-gradient">{copy.ticketHome.titleLuckyDraw}</span>
              </span>
            </h1>
            <p className="hero-intro">
              {copy.ticketHome.intro}
            </p>
          </div>

          <div className="hero-search">
            <label className="search-box large">
              <Search size={20} />
              <input
                data-ticket-search="true"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.ticketHome.walletPlaceholder}
                spellCheck={false}
              />
            </label>
            <button className="btn btn-main" type="button" onClick={() => setQuery(query.trim())}>
              <span className="shine" />
              <Search size={18} />
              <span>{copy.common.search}</span>
            </button>
          </div>

          {connectedAddress && (
            <button className="wallet-query-button" type="button" onClick={() => setQuery(connectedAddress)}>
              <Ticket size={17} />
              {copy.ticketHome.useConnectedWallet}
            </button>
          )}

          {entry ? (
            <div className="hero-result-grid rolling-result-grid" key={entry.userAddress}>
              <div>
                <span>{copy.ticketHome.wallet}</span>
                <strong>
                  <RollingReveal value={formatAddress(entry.userAddress)} delay={0} />
                </strong>
              </div>
              <div>
                <span>{copy.ticketHome.finalTickets}</span>
                <strong>
                  <RollingReveal value={compactNumber(entry.finalTickets)} delay={120} />
                </strong>
              </div>
              <div className={`hero-sbt-tile ${activeSbtImage ? 'has-sbt-art' : ''}`}>
                {activeSbtImage && (
                  <img
                    className="hero-sbt-image"
                    src={activeSbtImage}
                    alt={`${copy.sbt.tiers[entry.sbt]} SBT`}
                  />
                )}
                <span>{copy.ticketHome.sbtTier}</span>
                <strong>
                  <RollingReveal value={activeSbtLabel} delay={240} />
                </strong>
              </div>
              <div>
                <span>{copy.ticketHome.anyPrizeOdds}</span>
                <strong>
                  <RollingReveal value={percent(anyPrizeOdds)} delay={360} />
                </strong>
              </div>
            </div>
          ) : (
            <div className="hero-empty">
              {hasQuery ? copy.ticketHome.noTickets : copy.ticketHome.searchEmpty}
            </div>
          )}

          <div className="status-row hero-status-row">
            <span className="pill good">
              <ShieldCheck size={16} />
              {copy.ticketHome.ledgerReady}
            </span>
            {ledger.candidateSourceLimited && (
              <span className="pill warning">
                <ShieldCheck size={16} />
                {copy.ticketHome.candidateSourceLimited}
              </span>
            )}
            <span className="pill">
              <Hash size={16} />
              {ledgerHashLabel}
            </span>
          </div>
        </div>

        <aside className="hero-visual grand-prize-stage">
          <HoloPrizeCard />
        </aside>
      </section>

      <section className="hero-ledger-strip" aria-label={copy.ticketHome.ledgerSummary}>
        <div>
          <span>{copy.ticketHome.totalFinalTickets}</span>
          <strong>{compactNumber(ledger.totalFinalTickets)}</strong>
        </div>
        <div>
          <span>
            {ledger.candidateSourceLimited
              ? copy.ticketHome.loadedCandidateAddresses
              : copy.ticketHome.loadedParticipants}
          </span>
          <strong>{compactNumber(ledger.totalEntries)}</strong>
        </div>
        <div>
          <span>{copy.ticketHome.issuedThrough}</span>
          <strong>#{compactNumber(ledger.totalFinalTickets)}</strong>
        </div>
        <div>
          <span>{copy.ticketHome.lastScan}</span>
          <strong>{formatRefreshTime(lastLedgerRefreshAt, language)}</strong>
        </div>
        <div>
          <span>{copy.ticketHome.nextScan}</span>
          <strong>{formatRefreshTime(nextLedgerRefreshAt, language)}</strong>
        </div>
        <div>
          <span>{copy.ticketHome.ledgerHash}</span>
          <strong>{ledgerHashLabel}</strong>
        </div>
      </section>

      <section className="ticket-detail-layout">
        <section className="panel ticket-number-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{copy.ticketHome.assignedNumbers}</span>
              <h2>{copy.ticketHome.yourTicketRanges}</h2>
              {entry && (
                <p className="ticket-range-count">
                  {compactNumber(intervals.length)} {copy.ticketHome.rangesLabel} ·{' '}
                  {compactNumber(entry.finalTickets)} {copy.ticketHome.ticketsLabel}
                </p>
              )}
            </div>
            <button
              className={`icon-button copy-ticket-button copy-ticket-button--${copyState}`}
              type="button"
              onClick={copyTickets}
              disabled={intervals.length === 0}
            >
              <Copy size={18} />
              <span>
                {copyState === 'copied'
                  ? copy.ticketHome.copied
                  : copyState === 'failed'
                    ? copy.ticketHome.copyFailed
                    : copy.ticketHome.copyTickets}
              </span>
            </button>
          </div>

          {entry && intervals.length > 0 ? (
            <div className="interval-list ticket-home-list">
              {intervals.map((interval, index) => (
                <article
                  className="interval-row rolling-interval-row"
                  key={`${interval.start}-${interval.end}-${index}`}
                  style={{ animationDelay: `${Math.min(index, 18) * 28}ms` }}
                >
                  <div>
                    <strong>{intervalLabel(interval)}</strong>
                    <span>
                      {intervalEventText(interval, copy)}
                      {interval.txHash && (
                        <>
                          {' · '}
                          <a
                            className="interval-tx-link"
                            href={bscTxUrl(interval.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            title={interval.txHash}
                          >
                            {copy.ticketHome.transactionId} {interval.txHash.slice(0, 10)}...
                            {interval.txHash.slice(-6)}
                          </a>
                        </>
                      )}
                    </span>
                  </div>
                  <span>{interval.timestamp ? new Date(interval.timestamp * 1000).toLocaleString(language) : ''}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">{copy.ticketHome.exactRangesEmpty}</div>
          )}
        </section>

        <aside className="ticket-side-stack">
          <section className={`panel sbt-mini-panel ${activeSbtImage ? 'sbt-mini-panel--active' : ''}`}>
            <div className="sbt-mini-art">
              <img
                src={activeSbtImage || sbtLevelsImage}
                alt={activeSbtImage ? `${activeSbtLabel} SBT` : 'Renaiss SBT level artwork'}
              />
            </div>
            <div>
              <span className="eyebrow">{copy.ticketHome.sbtMultiplier}</span>
              <h2>{activeSbtImage ? activeSbtLabel : copy.ticketHome.levelUpChance}</h2>
            </div>
          </section>

          <section className="panel odds-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{copy.ticketHome.ticketMath}</span>
                <h2>{copy.ticketHome.currentWallet}</h2>
              </div>
              <Sparkles size={22} />
            </div>
            <div className="ticket-summary vertical-summary">
              <div>
                <span>{copy.ticketHome.rawTickets}</span>
                <strong>{entry ? compactNumber(entry.rawTickets) : '-'}</strong>
              </div>
              <div>
                <span>{copy.ticketHome.finalTickets}</span>
                <strong>{entry ? compactNumber(entry.finalTickets) : '-'}</strong>
              </div>
              <div>
                <span>{copy.ticketHome.grandPrizeOdds}</span>
                <strong>{percent(grandPrizeOdds)}</strong>
              </div>
              <div>
                <span>{copy.ticketHome.anyPrizeOdds}</span>
                <strong>{percent(anyPrizeOdds)}</strong>
              </div>
            </div>
            {entry && (
              <div className="pack-strip">
                {Object.entries(PACK_LABELS).map(([key, label]) => (
                  <div key={key}>
                    <span>{copy.packs[key as keyof typeof PACK_LABELS] || label}</span>
                    <strong>
                      {compactNumber(entry.packs[key as keyof typeof PACK_LABELS])}
                      <small> x{PACK_WEIGHTS[key as keyof typeof PACK_LABELS]}</small>
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel ledger-mini-panel">
            <Gem size={24} />
            <div>
              <span>Total final tickets</span>
              <strong>{compactNumber(ledger.totalFinalTickets)}</strong>
              <small>
                {compactNumber(ledger.totalEntries)}{' '}
                {ledger.candidateSourceLimited
                  ? copy.ticketHome.candidateAddressesShort
                  : copy.ticketHome.loadedParticipantsShort}
              </small>
            </div>
            <Trophy size={24} />
          </section>
        </aside>
      </section>
    </>
  )
}
