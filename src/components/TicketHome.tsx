import { useEffect, useRef, useState } from 'react'
import { Copy, Gem, Search, ShieldCheck, Sparkles, Ticket, Trophy } from 'lucide-react'
import sbtBrownImage from '../assets/sbt-brown.png'
import sbtGoldImage from '../assets/sbt-gold.png'
import sbtRainbowImage from '../assets/sbt-rainbow.png'
import sbtSilverImage from '../assets/sbt-silver.png'
import sbtLevelsImage from '../assets/van-gogh-sbt-levels-source.jpeg'
import type { AppCopy, LanguageCode } from '../lib/i18n'
import { packLabel } from '../lib/i18n'
import { anyPrizeProbability, compactNumber, intervalLabel, percent, probability } from '../lib/ticketing/display'
import { formatAddress, formatTicketRange, PACK_LABELS, PACK_WEIGHTS } from '../lib/ticketing/rules'
import type { RaffleEntry, RaffleLedger, SbtTier, TicketInterval } from '../lib/ticketing/types'
import { HoloPrizeCard } from './HoloPrizeCard'
import { RollingReveal } from './RollingReveal'

const RESULT_REVEAL_DELAYS_MS = [320, 1320, 2320, 3320]
const LEDGER_SCAN_MS = 900

type SearchPhase = 'idle' | 'scanning' | 'settled'
type TicketSearchSource = 'manual' | 'connected_wallet'

type TicketSearchDetails = {
  has_query: boolean
  source: TicketSearchSource
}

type TicketSearchResultDetails = {
  bonus_ticket_count?: number
  final_ticket_count?: number
  interval_count?: number
  raw_ticket_count?: number
  result: 'found' | 'not_found'
  sbt_tier?: SbtTier
}

type CopyTicketRangesDetails = {
  interval_count: number
  status: 'success' | 'failed'
}

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
  onHiddenDrawUnlock,
  onCopyTicketRanges,
  onTicketSearch,
  onTicketSearchResult,
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
  onHiddenDrawUnlock?: () => void
  onCopyTicketRanges?: (details: CopyTicketRangesDetails) => void
  onTicketSearch?: (details: TicketSearchDetails) => void
  onTicketSearchResult?: (details: TicketSearchResultDetails) => void
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [resultRevealRun, setResultRevealRun] = useState(0)
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle')
  const scanTimerRef = useRef<number | null>(null)
  const reportedSearchResultRef = useRef('')
  const normalizedQuery = query.trim()
  const isSubmittedQuery = submittedQuery.length > 0 && submittedQuery === normalizedQuery
  const isScanningLedger = isSubmittedQuery && searchPhase === 'scanning'
  const hasSettledSearch = isSubmittedQuery && searchPhase === 'settled'
  const displayEntry = hasSettledSearch ? entry : null
  const intervals = displayEntry?.ticketIntervals ?? []
  const rawIntervals = intervals.filter((interval) => interval.namespace !== 'bonus' && interval.source !== 'sbt-bonus')
  const bonusIntervals = intervals.filter((interval) => interval.namespace === 'bonus' || interval.source === 'sbt-bonus')
  const grandPrizeOdds = probability(displayEntry, ledger.totalFinalTickets)
  const anyPrizeOdds = anyPrizeProbability(displayEntry, ledger.totalFinalTickets)
  const activeSbtImage = displayEntry ? SBT_TIER_IMAGES[displayEntry.sbt] : undefined
  const activeSbtLabel = displayEntry
    ? displayEntry.sbt === 'none'
      ? copy.sbt.tiers.none
    : `${copy.sbt.tiers[displayEntry.sbt]} SBT`
    : copy.ticketHome.sbtMultiplier
  const emptyStateClassName = [
    'hero-empty',
    isScanningLedger ? 'hero-empty--scanning' : '',
    hasSettledSearch && !displayEntry ? 'hero-empty--not-found' : '',
  ].filter(Boolean).join(' ')

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!hasSettledSearch || !submittedQuery) return

    const reportKey = `${submittedQuery}:${displayEntry?.userAddress ?? 'not-found'}`
    if (reportedSearchResultRef.current === reportKey) return

    reportedSearchResultRef.current = reportKey
    onTicketSearchResult?.({
      bonus_ticket_count: displayEntry?.bonusTickets,
      final_ticket_count: displayEntry?.finalTickets,
      interval_count: displayEntry?.ticketIntervals.length,
      raw_ticket_count: displayEntry?.rawTickets,
      result: displayEntry ? 'found' : 'not_found',
      sbt_tier: displayEntry?.sbt,
    })
  }, [displayEntry, hasSettledSearch, onTicketSearchResult, submittedQuery])

  function clearScanTimer() {
    if (!scanTimerRef.current) return
    window.clearTimeout(scanTimerRef.current)
    scanTimerRef.current = null
  }

  function handleQueryChange(value: string) {
    clearScanTimer()
    setSubmittedQuery('')
    setSearchPhase('idle')
    setQuery(value)
  }

  function submitQuery(value = query, source: TicketSearchSource = 'manual') {
    const nextQuery = value.trim()
    clearScanTimer()
    setQuery(nextQuery)
    setResultRevealRun((current) => current + 1)
    onTicketSearch?.({
      has_query: nextQuery.length > 0,
      source,
    })
    if (!nextQuery) {
      setSubmittedQuery('')
      setSearchPhase('idle')
      return
    }

    setSubmittedQuery(nextQuery)
    setSearchPhase('scanning')
    scanTimerRef.current = window.setTimeout(() => {
      setSearchPhase('settled')
      scanTimerRef.current = null
    }, LEDGER_SCAN_MS)
  }

  async function copyTickets() {
    if (!displayEntry || intervals.length === 0) return
    const text = intervals
      .map((interval) => {
        const lines = [
          intervalLabel(interval),
          intervalEventText(interval, copy),
          interval.namespace === 'bonus'
            ? `${copy.ticketHome.globalDrawNumber}: ${formatTicketRange(interval.start, interval.end)}`
            : '',
          interval.txHash ? `${copy.ticketHome.transactionId}: ${interval.txHash}` : '',
          interval.timestamp ? new Date(interval.timestamp * 1000).toLocaleString(language) : '',
        ].filter(Boolean)
        return lines.join(' · ')
      })
      .join('\n')

    try {
      await writeClipboardText(text)
      setCopyState('copied')
      onCopyTicketRanges?.({
        interval_count: intervals.length,
        status: 'success',
      })
    } catch {
      setCopyState('failed')
      onCopyTicketRanges?.({
        interval_count: intervals.length,
        status: 'failed',
      })
    } finally {
      window.setTimeout(() => setCopyState('idle'), 1800)
    }
  }

  return (
    <>
      <section id="tickets" className="panel hero ticket-home-hero">
        <div className="ticket-search-stage">
          <div className="ticket-headline">
            <button
              className="chip chain-badge-trigger"
              type="button"
              onClick={onHiddenDrawUnlock}
              aria-label={copy.ticketHome.chainBadge}
            >
              <Gem size={14} />
              {copy.ticketHome.chainBadge}
            </button>
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
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder={copy.ticketHome.walletPlaceholder}
                spellCheck={false}
              />
            </label>
            <button className="btn btn-main" type="button" onClick={() => submitQuery()}>
              <span className="shine" />
              <Search size={18} />
              <span>{copy.common.search}</span>
            </button>
          </div>

          {connectedAddress && (
            <button className="wallet-query-button" type="button" onClick={() => submitQuery(connectedAddress, 'connected_wallet')}>
              <Ticket size={17} />
              {copy.ticketHome.useConnectedWallet}
            </button>
          )}

          {displayEntry ? (
            <div className="hero-result-grid rolling-result-grid" key={`${displayEntry.userAddress}-${resultRevealRun}`}>
              <div className="hero-result-card hero-result-card--wallet">
                <span>{copy.ticketHome.wallet}</span>
                <strong>
                  <RollingReveal value={formatAddress(displayEntry.userAddress)} delay={RESULT_REVEAL_DELAYS_MS[0]} />
                </strong>
              </div>
              <div className="hero-result-card hero-result-card--tickets">
                <span>{copy.ticketHome.finalTickets}</span>
                <strong>
                  <RollingReveal value={compactNumber(displayEntry.finalTickets)} delay={RESULT_REVEAL_DELAYS_MS[1]} />
                </strong>
              </div>
              <div className={`hero-result-card hero-result-card--sbt hero-sbt-tile ${activeSbtImage ? 'has-sbt-art' : ''}`}>
                {activeSbtImage && (
                  <img
                    className="hero-sbt-image"
                    src={activeSbtImage}
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <span>{copy.ticketHome.sbtTier}</span>
                <strong>
                  <RollingReveal value={activeSbtLabel} delay={RESULT_REVEAL_DELAYS_MS[2]} />
                </strong>
              </div>
              <div className="hero-result-card hero-result-card--odds">
                <span>{copy.ticketHome.anyPrizeOdds}</span>
                <strong>
                  <RollingReveal value={percent(anyPrizeOdds)} delay={RESULT_REVEAL_DELAYS_MS[3]} />
                </strong>
              </div>
            </div>
          ) : (
            <div
              className={emptyStateClassName}
              role="status"
              aria-live="polite"
              aria-busy={isScanningLedger}
            >
              {(isScanningLedger || hasSettledSearch) && (
                <span className="ledger-scan-mark" aria-hidden="true" />
              )}
              <span>
                {isScanningLedger
                  ? copy.ticketHome.searchingLedger
                  : hasSettledSearch
                    ? copy.ticketHome.noTickets
                    : copy.ticketHome.searchEmpty}
              </span>
            </div>
          )}

          {ledger.candidateSourceLimited && (
            <div className="status-row hero-status-row">
              <span className="pill warning">
                <ShieldCheck size={16} />
                {copy.ticketHome.candidateSourceLimited}
              </span>
            </div>
          )}
        </div>

        <aside className="hero-visual grand-prize-stage">
          <HoloPrizeCard />
        </aside>

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
            <span>{copy.ticketHome.issuedRawThrough}</span>
            <strong>R-{String(ledger.totalRawTickets || 0).padStart(6, '0')}</strong>
          </div>
          <div>
            <span>{copy.ticketHome.issuedBonusThrough}</span>
            <strong>B-{String(ledger.totalBonusTickets || 0).padStart(6, '0')}</strong>
          </div>
          <div>
            <span>{copy.ticketHome.lastScan}</span>
            <strong>{formatRefreshTime(lastLedgerRefreshAt, language)}</strong>
          </div>
          <div>
            <span>{copy.ticketHome.nextScan}</span>
            <strong>{formatRefreshTime(nextLedgerRefreshAt, language)}</strong>
          </div>
        </section>
      </section>

      <section className="ticket-detail-layout">
        <section className="panel ticket-number-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{copy.ticketHome.assignedNumbers}</span>
              <h2>{copy.ticketHome.yourTicketRanges}</h2>
              {displayEntry && (
                <p className="ticket-range-count">
                  {compactNumber(displayEntry.rawTickets)} R · {compactNumber(displayEntry.bonusTickets)} B ·{' '}
                  {compactNumber(displayEntry.finalTickets)} {copy.ticketHome.ticketsLabel}
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

          {displayEntry && intervals.length > 0 ? (
            <div className="interval-list ticket-home-list">
              {rawIntervals.length > 0 && (
                <div className="interval-group">
                  <div className="interval-group-heading">
                    <span>{copy.ticketHome.rawTicketNumbers}</span>
                    <strong>{compactNumber(displayEntry.rawTickets)} R</strong>
                  </div>
                  {rawIntervals.map((interval, index) => (
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
              )}

              {bonusIntervals.length > 0 && (
                <div className="interval-group interval-group--bonus">
                  <div className="interval-group-heading">
                    <span>{copy.ticketHome.bonusTicketNumbers}</span>
                    <strong>{compactNumber(displayEntry.bonusTickets)} B</strong>
                  </div>
                  <p className="bonus-provisional-note">{copy.ticketHome.bonusNumbersNotice}</p>
                  {bonusIntervals.map((interval, index) => (
                    <article
                      className="interval-row rolling-interval-row interval-row--bonus"
                      key={`${interval.start}-${interval.end}-${index}`}
                      style={{ animationDelay: `${Math.min(index + rawIntervals.length, 18) * 28}ms` }}
                    >
                      <div>
                        <strong>{intervalLabel(interval)}</strong>
                        <span>
                          {intervalEventText(interval, copy)} · {copy.ticketHome.globalDrawNumber}{' '}
                          {formatTicketRange(interval.start, interval.end)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
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
                <strong>{displayEntry ? compactNumber(displayEntry.rawTickets) : '-'}</strong>
              </div>
              <div>
                <span>{copy.ticketHome.bonusTicketNumbers}</span>
                <strong>{displayEntry ? compactNumber(displayEntry.bonusTickets) : '-'}</strong>
              </div>
              <div>
                <span>{copy.ticketHome.finalTickets}</span>
                <strong>{displayEntry ? compactNumber(displayEntry.finalTickets) : '-'}</strong>
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
            {displayEntry && (
              <div className="pack-strip">
                {Object.entries(PACK_LABELS).map(([key, label]) => (
                  <div key={key}>
                    <span>{copy.packs[key as keyof typeof PACK_LABELS] || label}</span>
                    <strong>
                      {compactNumber(displayEntry.packs[key as keyof typeof PACK_LABELS])}
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
              <span>{copy.ticketHome.totalFinalTickets}</span>
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
