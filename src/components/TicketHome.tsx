import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AtSign, Copy, Download, Gem, Hash, Search, ShieldCheck, Sparkles, Ticket, Trophy, UserRound, Wallet } from 'lucide-react'
import sbtBrownImage from '../assets/sbt-brown.webp'
import sbtGoldImage from '../assets/sbt-gold.webp'
import sbtRainbowImage from '../assets/sbt-rainbow.webp'
import sbtSilverImage from '../assets/sbt-silver.webp'
import sbtLevelsImage from '../assets/van-gogh-sbt-levels-source.webp'
import type { AppCopy, LanguageCode } from '../lib/i18n'
import { packLabel } from '../lib/i18n'
import { anyPrizeProbability, compactNumber, intervalLabel, percent, probability } from '../lib/ticketing/display'
import type { IdentitySuggestion, IdentitySuggestionKind, WalletIdentityMap } from '../lib/ticketing/identities'
import { formatAddress, formatTicketRange, packDisplayRows } from '../lib/ticketing/rules'
import type { RaffleEntry, RaffleLeaderboardEntry, RaffleLedger, SbtTier, TicketInterval } from '../lib/ticketing/types'
import { HoloPrizeCard } from './HoloPrizeCard'
import { RollingReveal } from './RollingReveal'

const RESULT_REVEAL_DELAYS_MS = [320, 1320, 2320, 3320]
const LEDGER_SCAN_MS = 180
const INTERVAL_PAGE_SIZE = 120
const IDENTITY_SUGGESTION_LIMIT = 8
const IDENTITY_SUGGESTION_MIN_CHARS = 2
const IDENTITY_SUGGESTION_DEBOUNCE_MS = 140
const EMPTY_INTERVALS: TicketInterval[] = []

type SearchPhase = 'idle' | 'scanning' | 'settled'
type IntervalLoadState = 'idle' | 'loading' | 'ready' | 'failed'
type SuggestionLoadState = 'idle' | 'loading' | 'ready' | 'failed'
type ExportState = 'idle' | 'loading' | 'exported' | 'failed'
type TicketSearchSource = 'manual' | 'connected_wallet' | 'suggestion'

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

type LoadEntryIntervalsRequest = {
  offset: number
  limit: number | 'all'
}

const SUGGESTION_ICONS: Record<IdentitySuggestionKind, typeof Wallet> = {
  address: Wallet,
  username: UserRound,
  twitter: AtSign,
  discord: Hash,
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

function intervalEventText(interval: TicketInterval, copy: AppCopy, ledger: RaffleLedger): string {
  if (!interval.pack) return copy.ticketHome.bonus
  return `${packLabel(interval.pack, copy, ledger)} ${copy.ticketHome.buybackSuffix}`
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

function ledgerLocked(ledger: RaffleLedger): boolean {
  return Boolean(ledger.bonusShuffleLocked)
}

function ticketCountLabel(ledger: RaffleLedger, copy: AppCopy): string {
  return ledgerLocked(ledger) ? copy.ticketHome.finalTickets : copy.ticketHome.currentTickets
}

function totalTicketCountLabel(ledger: RaffleLedger, copy: AppCopy): string {
  return ledgerLocked(ledger) ? copy.ticketHome.totalFinalTickets : copy.ticketHome.totalCurrentTickets
}

function bonusTicketNotice(ledger: RaffleLedger, copy: AppCopy): string {
  return ledgerLocked(ledger) ? copy.ticketHome.bonusNumbersLockedNotice : copy.ticketHome.bonusNumbersNotice
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function downloadTextFile(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function ticketExportFilename(entry: RaffleEntry): string {
  const wallet = entry.userAddress ? entry.userAddress.slice(0, 10) : 'wallet'
  return `renaiss-ticket-ranges-${wallet}.csv`
}

function sbtLabel(entry: RaffleLeaderboardEntry, copy: AppCopy): string {
  if (entry.sbt === 'none') return copy.sbt.tiers.none
  return `${copy.sbt.tiers[entry.sbt]} x${entry.sbtMultiplier}`
}

function leaderboardStyle(entry: RaffleLeaderboardEntry, totalTickets: number): CSSProperties {
  const share = totalTickets > 0 ? Math.min(100, Math.max(0, (entry.finalTickets / totalTickets) * 100)) : 0
  return { '--leader-share': `${share}%` } as CSSProperties
}

function leaderboardIdentity(entry: RaffleLeaderboardEntry, walletIdentities: WalletIdentityMap) {
  const entryIdentityName =
    entry.identity?.username?.trim() || entry.identity?.linkedTwitter?.trim() || entry.identity?.linkedDiscord?.trim()
  if (entryIdentityName) {
    return {
      displayName: entryIdentityName,
      identityAddress: entry.identityAddress || entry.userAddress,
      hasIdentity: true,
    }
  }

  const addresses = [entry.userAddress, ...(entry.sourceAddresses ?? [])]
  for (const address of addresses) {
    const identity = walletIdentities[address.toLowerCase()]
    const displayName = identity?.username?.trim() || identity?.linkedTwitter?.trim() || identity?.linkedDiscord?.trim()
    if (displayName) {
      return {
        displayName,
        identityAddress: address,
        hasIdentity: true,
      }
    }
  }

  return {
    displayName: formatAddress(entry.userAddress),
    identityAddress: entry.userAddress,
    hasIdentity: false,
  }
}

function TopTenLeaderboard({
  ledger,
  walletIdentities,
  copy,
}: {
  ledger: RaffleLedger
  walletIdentities: WalletIdentityMap
  copy: AppCopy
}) {
  const entries = ledger.leaderboardEntries ?? []
  if (entries.length === 0) return null

  const podium = entries.slice(0, 3)
  const rest = entries.slice(3, 10)
  const totalTicketTitle = totalTicketCountLabel(ledger, copy)

  return (
    <section id="top-collectors" className="van-gogh-leaderboard" aria-label={copy.ticketHome.leaderboardTitle}>
      <div className="van-gogh-leaderboard__header">
        <div>
          <span className="eyebrow">{copy.ticketHome.leaderboardEyebrow}</span>
          <h2>{copy.ticketHome.leaderboardTitle}</h2>
          <p>{copy.ticketHome.leaderboardCopy}</p>
        </div>
        <div className="van-gogh-leaderboard__total">
          <span>{totalTicketTitle}</span>
          <strong>{compactNumber(ledger.totalFinalTickets)}</strong>
        </div>
      </div>

      <div className="van-gogh-leaderboard__podium">
        {podium.map((entry) => {
          const identity = leaderboardIdentity(entry, walletIdentities)
          return (
            <article
              className={`leader-podium leader-podium--rank-${entry.rank}`}
              key={entry.userAddress}
              style={leaderboardStyle(entry, ledger.totalFinalTickets)}
            >
              <div className="leader-podium__rank">
                <Trophy size={18} />
                <span>#{entry.rank}</span>
              </div>
              <strong>{compactNumber(entry.finalTickets)}</strong>
              <span className="leader-podium__name">{identity.displayName}</span>
              <small className="leader-podium__address">{formatAddress(identity.identityAddress)}</small>
              <small className="leader-podium__stats">
                {compactNumber(entry.rawTickets)} R · {compactNumber(entry.bonusTickets)} B · {sbtLabel(entry, copy)}
              </small>
              <div className="leader-share-bar" aria-hidden="true" />
            </article>
          )
        })}
      </div>

      {rest.length > 0 && (
        <div className="van-gogh-leaderboard__rows">
          {rest.map((entry) => {
            const identity = leaderboardIdentity(entry, walletIdentities)
            return (
              <article className="leader-row" key={entry.userAddress} style={leaderboardStyle(entry, ledger.totalFinalTickets)}>
                <div className="leader-row__rank">
                  <span>{copy.ticketHome.leaderboardRank}</span>
                  <strong>#{entry.rank}</strong>
                </div>
                <div className="leader-row__wallet">
                  <strong>{identity.displayName}</strong>
                  <span>
                    {formatAddress(identity.identityAddress)} · {compactNumber(entry.eventCount)} {copy.ticketHome.leaderboardEvents} ·{' '}
                    {sbtLabel(entry, copy)}
                  </span>
                </div>
                <div className="leader-row__tickets">
                  <strong>{compactNumber(entry.finalTickets)}</strong>
                  <span>
                    {copy.ticketHome.leaderboardShare}{' '}
                    {ledger.totalFinalTickets > 0 ? `${((entry.finalTickets / ledger.totalFinalTickets) * 100).toFixed(2)}%` : '0%'}
                  </span>
                </div>
                <div className="leader-share-bar" aria-hidden="true" />
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function TicketHome({
  ledger,
  entry,
  query,
  setQuery,
  connectedAddress,
  walletIdentities,
  copy,
  language,
  lastLedgerRefreshAt,
  nextLedgerRefreshAt,
  onHiddenDrawUnlock,
  onCopyTicketRanges,
  onLoadIdentitySuggestions,
  onResolveEntry,
  onLoadEntryIntervals,
  onTicketSearch,
  onTicketSearchResult,
}: {
  ledger: RaffleLedger
  entry: RaffleEntry | null
  query: string
  setQuery: (value: string) => void
  connectedAddress?: string
  walletIdentities: WalletIdentityMap
  copy: AppCopy
  language: LanguageCode
  lastLedgerRefreshAt: number
  nextLedgerRefreshAt: number
  onHiddenDrawUnlock?: () => void
  onCopyTicketRanges?: (details: CopyTicketRangesDetails) => void
  onLoadIdentitySuggestions?: (query: string, limit?: number) => Promise<IdentitySuggestion[]>
  onResolveEntry?: (query: string) => Promise<RaffleEntry | null>
  onLoadEntryIntervals?: (query: string, request: LoadEntryIntervalsRequest) => Promise<RaffleEntry | null>
  onTicketSearch?: (details: TicketSearchDetails) => void
  onTicketSearchResult?: (details: TicketSearchResultDetails) => void
}) {
  const [copyState, setCopyState] = useState<'idle' | 'loading' | 'copied' | 'failed'>('idle')
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [resultRevealRun, setResultRevealRun] = useState(0)
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle')
  const [searchError, setSearchError] = useState('')
  const [identitySuggestions, setIdentitySuggestions] = useState<IdentitySuggestion[]>([])
  const [suggestionLoadState, setSuggestionLoadState] = useState<SuggestionLoadState>('idle')
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [intervalEntry, setIntervalEntry] = useState<RaffleEntry | null>(null)
  const [intervalLoadState, setIntervalLoadState] = useState<IntervalLoadState>('idle')
  const [intervalLoadError, setIntervalLoadError] = useState('')
  const scanTimerRef = useRef<number | null>(null)
  const intervalRequestRef = useRef(0)
  const reportedSearchResultRef = useRef('')
  const searchRequestRef = useRef(0)
  const suggestionRequestRef = useRef(0)
  const suggestionsId = useId()
  const normalizedQuery = query.trim()
  const isSubmittedQuery = submittedQuery.length > 0 && submittedQuery === normalizedQuery
  const isScanningLedger = isSubmittedQuery && searchPhase === 'scanning'
  const hasSettledSearch = isSubmittedQuery && searchPhase === 'settled'
  const displayEntry = hasSettledSearch ? entry : null
  const totalIntervalCount = displayEntry?.ticketIntervalCount ?? displayEntry?.ticketIntervals.length ?? 0
  const intervals = useMemo(
    () => intervalEntry?.ticketIntervals ?? displayEntry?.ticketIntervals ?? EMPTY_INTERVALS,
    [displayEntry?.ticketIntervals, intervalEntry?.ticketIntervals],
  )
  const hasMoreIntervals = Boolean(displayEntry && onLoadEntryIntervals && intervals.length < totalIntervalCount)
  const isLoadingInitialIntervals = intervalLoadState === 'loading' && intervals.length === 0
  const { rawIntervals, bonusIntervals } = useMemo(() => {
    const nextRawIntervals: TicketInterval[] = []
    const nextBonusIntervals: TicketInterval[] = []

    for (const interval of intervals) {
      if (interval.namespace === 'bonus' || interval.source === 'sbt-bonus') {
        nextBonusIntervals.push(interval)
      } else {
        nextRawIntervals.push(interval)
      }
    }

    return {
      rawIntervals: nextRawIntervals,
      bonusIntervals: nextBonusIntervals,
    }
  }, [intervals])
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
  const showIdentitySuggestions = suggestionsOpen && identitySuggestions.length > 0 && !isScanningLedger
  const ticketCountTitle = ticketCountLabel(ledger, copy)
  const totalTicketCountTitle = totalTicketCountLabel(ledger, copy)
  const bonusNumbersNotice = bonusTicketNotice(ledger, copy)

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
      searchRequestRef.current += 1
      intervalRequestRef.current += 1
      suggestionRequestRef.current += 1
    }
  }, [])

  useEffect(() => {
    suggestionRequestRef.current += 1
    const requestId = suggestionRequestRef.current
    const nextQuery = normalizedQuery

    if (!onLoadIdentitySuggestions || nextQuery.length < IDENTITY_SUGGESTION_MIN_CHARS || isSubmittedQuery) {
      const idleTimeoutId = window.setTimeout(() => {
        if (suggestionRequestRef.current !== requestId) return
        setIdentitySuggestions([])
        setSuggestionLoadState('idle')
      }, 0)

      return () => {
        window.clearTimeout(idleTimeoutId)
      }
    }

    const loadingTimeoutId = window.setTimeout(() => {
      if (suggestionRequestRef.current !== requestId) return
      setSuggestionLoadState('loading')
    }, 0)
    const timeoutId = window.setTimeout(() => {
      if (suggestionRequestRef.current !== requestId) return
      void onLoadIdentitySuggestions(nextQuery, IDENTITY_SUGGESTION_LIMIT)
        .then((suggestions) => {
          if (suggestionRequestRef.current !== requestId) return
          setIdentitySuggestions(suggestions)
          setSuggestionLoadState('ready')
          setSuggestionsOpen(suggestions.length > 0)
        })
        .catch(() => {
          if (suggestionRequestRef.current !== requestId) return
          setIdentitySuggestions([])
          setSuggestionLoadState('failed')
        })
    }, IDENTITY_SUGGESTION_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(loadingTimeoutId)
      window.clearTimeout(timeoutId)
    }
  }, [isSubmittedQuery, normalizedQuery, onLoadIdentitySuggestions])

  useEffect(() => {
    intervalRequestRef.current += 1
    const requestId = intervalRequestRef.current
    let cancelled = false

    void Promise.resolve().then(() => {
      if (cancelled || intervalRequestRef.current !== requestId) return
      setCopyState('idle')
      setExportState('idle')
      setIntervalEntry(null)
      setIntervalLoadError('')

      if (!displayEntry) {
        setIntervalLoadState('idle')
        return
      }

      if (totalIntervalCount === 0 || displayEntry.ticketIntervals.length > 0 || !onLoadEntryIntervals) {
        setIntervalLoadState('ready')
        if (displayEntry.ticketIntervals.length > 0) setIntervalEntry(displayEntry)
        return
      }

      setIntervalLoadState('loading')
      void onLoadEntryIntervals(displayEntry.userAddress, { offset: 0, limit: INTERVAL_PAGE_SIZE })
        .then((nextEntry) => {
          if (cancelled || intervalRequestRef.current !== requestId) return
          setIntervalEntry(nextEntry)
          setIntervalLoadState('ready')
        })
        .catch((error) => {
          if (cancelled || intervalRequestRef.current !== requestId) return
          setIntervalLoadError(error instanceof Error ? error.message : 'Could not load ticket ranges.')
          setIntervalLoadState('failed')
        })
    })

    return () => {
      cancelled = true
    }
  }, [displayEntry, onLoadEntryIntervals, totalIntervalCount])

  useEffect(() => {
    if (!hasSettledSearch || !submittedQuery || searchError) return

    const reportKey = `${submittedQuery}:${displayEntry?.userAddress ?? 'not-found'}`
    if (reportedSearchResultRef.current === reportKey) return

    reportedSearchResultRef.current = reportKey
    onTicketSearchResult?.({
      bonus_ticket_count: displayEntry?.bonusTickets,
      final_ticket_count: displayEntry?.finalTickets,
      interval_count: displayEntry ? totalIntervalCount : undefined,
      raw_ticket_count: displayEntry?.rawTickets,
      result: displayEntry ? 'found' : 'not_found',
      sbt_tier: displayEntry?.sbt,
    })
  }, [displayEntry, hasSettledSearch, onTicketSearchResult, searchError, submittedQuery, totalIntervalCount])

  function clearScanTimer() {
    if (!scanTimerRef.current) return
    window.clearTimeout(scanTimerRef.current)
    scanTimerRef.current = null
  }

  function handleQueryChange(value: string) {
    clearScanTimer()
    searchRequestRef.current += 1
    setSearchError('')
    setSubmittedQuery('')
    setSearchPhase('idle')
    setSuggestionsOpen(true)
    setQuery(value)
  }

  async function waitForScanDelay() {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, LEDGER_SCAN_MS)
    })
  }

  function submitQuery(value = query, source: TicketSearchSource = 'manual') {
    const nextQuery = value.trim()
    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    clearScanTimer()
    setSearchError('')
    setIdentitySuggestions([])
    setSuggestionsOpen(false)
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
    if (!onResolveEntry) {
      scanTimerRef.current = window.setTimeout(() => {
        if (searchRequestRef.current === requestId) setSearchPhase('settled')
        scanTimerRef.current = null
      }, LEDGER_SCAN_MS)
      return
    }

    void Promise.allSettled([onResolveEntry(nextQuery), waitForScanDelay()]).then((results) => {
      if (searchRequestRef.current !== requestId) return
      const [entryResult] = results
      if (entryResult.status === 'rejected') {
        setSearchError(entryResult.reason instanceof Error ? entryResult.reason.message : 'Could not load raffle result.')
      }
      setSearchPhase('settled')
    })
  }

  function handleSuggestionSelect(suggestion: IdentitySuggestion) {
    submitQuery(suggestion.value, 'suggestion')
  }

  async function loadMoreIntervals() {
    if (!displayEntry || !onLoadEntryIntervals || intervalLoadState === 'loading' || !hasMoreIntervals) return
    const requestId = intervalRequestRef.current + 1
    intervalRequestRef.current = requestId
    setIntervalLoadError('')
    setIntervalLoadState('loading')

    try {
      const nextEntry = await onLoadEntryIntervals(displayEntry.userAddress, {
        offset: intervals.length,
        limit: INTERVAL_PAGE_SIZE,
      })
      if (intervalRequestRef.current !== requestId || !nextEntry) return

      const nextIntervals = nextEntry.ticketIntervals ?? []
      setIntervalEntry((current) => ({
        ...(nextEntry || displayEntry),
        ticketIntervals: [...(current?.ticketIntervals ?? intervals), ...nextIntervals],
        ticketIntervalCount: nextEntry.ticketIntervalCount ?? totalIntervalCount,
        ticketIntervalsOffset: 0,
        ticketIntervalsLimit: intervals.length + nextIntervals.length,
        ticketIntervalsComplete: intervals.length + nextIntervals.length >= (nextEntry.ticketIntervalCount ?? totalIntervalCount),
      }))
      setIntervalLoadState('ready')
    } catch (error) {
      if (intervalRequestRef.current !== requestId) return
      setIntervalLoadError(error instanceof Error ? error.message : 'Could not load ticket ranges.')
      setIntervalLoadState('failed')
    }
  }

  async function intervalsForCopy() {
    if (!displayEntry) return []
    if (!hasMoreIntervals || !onLoadEntryIntervals) return intervals

    const fullEntry = await onLoadEntryIntervals(displayEntry.userAddress, { offset: 0, limit: 'all' })
    return fullEntry?.ticketIntervals ?? intervals
  }

  async function copyTickets() {
    if (!displayEntry || totalIntervalCount === 0 || copyState === 'loading') return
    setCopyState('loading')

    try {
      const ticketIntervals = await intervalsForCopy()
      if (ticketIntervals.length === 0) throw new Error('No ticket ranges to copy.')

      const text = ticketIntervals
      .map((interval) => {
        const lines = [
          intervalLabel(interval),
          intervalEventText(interval, copy, ledger),
          interval.namespace === 'bonus'
            ? `${copy.ticketHome.globalDrawNumber}: ${formatTicketRange(interval.start, interval.end)}`
            : '',
          interval.txHash ? `${copy.ticketHome.transactionId}: ${interval.txHash}` : '',
          interval.timestamp ? new Date(interval.timestamp * 1000).toLocaleString(language) : '',
        ].filter(Boolean)
        return lines.join(' · ')
      })
      .join('\n')

      await writeClipboardText(text)
      setCopyState('copied')
      onCopyTicketRanges?.({
        interval_count: ticketIntervals.length,
        status: 'success',
      })
    } catch {
      setCopyState('failed')
      onCopyTicketRanges?.({
        interval_count: totalIntervalCount,
        status: 'failed',
      })
    } finally {
      window.setTimeout(() => setCopyState('idle'), 1800)
    }
  }

  async function exportTickets() {
    if (!displayEntry || totalIntervalCount === 0 || exportState === 'loading') return
    setExportState('loading')

    try {
      const ticketIntervals = await intervalsForCopy()
      if (ticketIntervals.length === 0) throw new Error('No ticket ranges to export.')

      const headers = [
        'wallet',
        'rank',
        'ticket_count_label',
        'ticket_count',
        'raw_tickets',
        'bonus_tickets',
        'sbt_tier',
        'sbt_multiplier',
        'range_type',
        'range_label',
        'start',
        'end',
        'display_start',
        'display_end',
        'global_draw_range',
        'source',
        'pack',
        'tx_hash',
        'timestamp',
        'timestamp_local',
        'block_number',
        'ordinal',
      ]
      const rows = ticketIntervals.map((interval) => {
        const rangeType = interval.namespace ?? (interval.source === 'sbt-bonus' ? 'bonus' : 'raw')
        return [
          displayEntry.userAddress,
          displayEntry.rank,
          ticketCountTitle,
          displayEntry.finalTickets,
          displayEntry.rawTickets,
          displayEntry.bonusTickets,
          displayEntry.sbt,
          displayEntry.sbtMultiplier,
          rangeType,
          intervalLabel(interval),
          interval.start,
          interval.end,
          interval.displayStart ?? interval.start,
          interval.displayEnd ?? interval.end,
          formatTicketRange(interval.start, interval.end),
          interval.source,
          interval.pack ? packLabel(interval.pack, copy, ledger) : '',
          interval.txHash ?? '',
          interval.timestamp ?? '',
          interval.timestamp ? new Date(interval.timestamp * 1000).toLocaleString(language) : '',
          interval.blockNumber ?? '',
          interval.ordinal ?? '',
        ]
      })
      const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')

      downloadTextFile(ticketExportFilename(displayEntry), csv)
      setExportState('exported')
    } catch {
      setExportState('failed')
    } finally {
      window.setTimeout(() => setExportState('idle'), 1800)
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

          <div className="hero-search-wrap">
            <div className="hero-search">
              <label className="search-box large">
                <Search size={20} />
                <input
                  aria-autocomplete="list"
                  aria-controls={showIdentitySuggestions ? suggestionsId : undefined}
                  aria-expanded={showIdentitySuggestions}
                  data-ticket-search="true"
                  value={query}
                  onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  onFocus={() => {
                    if (identitySuggestions.length > 0) setSuggestionsOpen(true)
                  }}
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

            {showIdentitySuggestions && (
              <div className="identity-suggestions" id={suggestionsId} role="listbox">
                {identitySuggestions.map((suggestion) => {
                  const SuggestionIcon = SUGGESTION_ICONS[suggestion.kind]
                  return (
                    <button
                      className="identity-suggestion"
                      key={`${suggestion.kind}:${suggestion.value}`}
                      role="option"
                      type="button"
                      onClick={() => handleSuggestionSelect(suggestion)}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <span className="identity-suggestion__icon">
                        <SuggestionIcon size={16} />
                      </span>
                      <span className="identity-suggestion__main">
                        <strong>{suggestion.label}</strong>
                        <small>{suggestion.detail}</small>
                      </span>
                      <span className="identity-suggestion__kind">{copy.ticketHome.lookupKinds[suggestion.kind]}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {suggestionLoadState === 'failed' && <span className="sr-only">{copy.ticketHome.suggestionsUnavailable}</span>}
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
                <span>{ticketCountTitle}</span>
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
                    decoding="async"
                    loading="lazy"
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
                  : searchError
                    ? searchError
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
            <span>{totalTicketCountTitle}</span>
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
                  {totalIntervalCount > 0 && (
                    <>
                      {' · '}
                      {compactNumber(intervals.length)} / {compactNumber(totalIntervalCount)} {copy.ticketHome.rangesLabel}
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="ticket-actions">
              <button
                className={`icon-button copy-ticket-button copy-ticket-button--${copyState}`}
                type="button"
                onClick={copyTickets}
                disabled={totalIntervalCount === 0 || copyState === 'loading'}
              >
                <Copy size={18} />
                <span>
                  {copyState === 'loading'
                    ? copy.ticketHome.loadingTicketRanges
                    : copyState === 'copied'
                    ? copy.ticketHome.copied
                    : copyState === 'failed'
                      ? copy.ticketHome.copyFailed
                      : copy.ticketHome.copyTickets}
                </span>
              </button>
              <button
                className={`icon-button copy-ticket-button copy-ticket-button--${exportState}`}
                type="button"
                onClick={exportTickets}
                disabled={totalIntervalCount === 0 || exportState === 'loading'}
              >
                <Download size={18} />
                <span>
                  {exportState === 'loading'
                    ? copy.ticketHome.loadingTicketRanges
                    : exportState === 'exported'
                    ? copy.ticketHome.exported
                    : exportState === 'failed'
                      ? copy.ticketHome.exportFailed
                      : copy.ticketHome.exportTickets}
                </span>
              </button>
            </div>
          </div>

          {displayEntry && totalIntervalCount > 0 ? (
            <div className="ticket-range-lazy-stack">
              {isLoadingInitialIntervals ? (
                <div className="empty-state interval-loading-state">{copy.ticketHome.loadingTicketRanges}</div>
              ) : intervals.length > 0 ? (
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
                              {intervalEventText(interval, copy, ledger)}
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
                      <p className="bonus-provisional-note">{bonusNumbersNotice}</p>
                      {bonusIntervals.map((interval, index) => (
                        <article
                          className="interval-row rolling-interval-row interval-row--bonus"
                          key={`${interval.start}-${interval.end}-${index}`}
                          style={{ animationDelay: `${Math.min(index + rawIntervals.length, 18) * 28}ms` }}
                        >
                          <div>
                            <strong>{intervalLabel(interval)}</strong>
                            <span>
                              {intervalEventText(interval, copy, ledger)} · {copy.ticketHome.globalDrawNumber}{' '}
                              {formatTicketRange(interval.start, interval.end)}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">{intervalLoadError || copy.ticketHome.exactRangesEmpty}</div>
              )}

              <div className="ticket-range-page-row">
                <span>
                  {compactNumber(intervals.length)} / {compactNumber(totalIntervalCount)} {copy.ticketHome.rangesLabel}
                  {hasMoreIntervals && ` · ${copy.ticketHome.showingFirstRanges}`}
                </span>
                {intervalLoadError && <small>{intervalLoadError}</small>}
                {hasMoreIntervals && (
                  <button
                    className="icon-button load-more-ranges-button"
                    type="button"
                    onClick={loadMoreIntervals}
                    disabled={intervalLoadState === 'loading'}
                  >
                    <Ticket size={17} />
                    <span>
                      {intervalLoadState === 'loading' ? copy.ticketHome.loadingRanges : copy.ticketHome.loadMoreRanges}
                    </span>
                  </button>
                )}
              </div>
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
                decoding="async"
                loading="lazy"
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
                <span>{ticketCountTitle}</span>
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
                {packDisplayRows(ledger, displayEntry.packs).map((row) => (
                  <div key={row.pack}>
                    <span>{packLabel(row.pack, copy, ledger)}</span>
                    <strong>
                      {compactNumber(displayEntry.packs[row.pack] || 0)}
                      <small> x{row.weight}</small>
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel ledger-mini-panel">
            <Gem size={24} />
            <div>
              <span>{totalTicketCountTitle}</span>
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

      <TopTenLeaderboard ledger={ledger} walletIdentities={walletIdentities} copy={copy} />
    </>
  )
}
