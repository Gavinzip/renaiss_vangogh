import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Loader2, LogOut, ShieldCheck, Trophy } from 'lucide-react'
import './App.css'
import './styles/raffle-foundation.css'
import './styles/raffle-tickets.css'
import './styles/raffle-rules.css'
import './styles/raffle-draw.css'
import './styles/raffle-simulator.css'
import './styles/raffle-polish.css'
import renaissLogo from './assets/renaiss-logo-alpha-cropped.webp'
import holoCardFrontImage from './assets/psa-pikachu-van-gogh-front-cut-fast.webp'
import liveDrawImage from './assets/van-gogh-live-source.webp'
import heroBackgroundImage from './assets/van-gogh-starry-hero-bg.webp'
import { InitialPageLoader } from './components/InitialPageLoader'
import { TicketHome } from './components/TicketHome'
import { WalletSelectorModal } from './components/WalletSelectorModal'
import { DrawTransactionTimeline } from './components/DrawTransactionTimeline'
import { initializeAnalytics, trackEvent, trackPageView } from './lib/analytics'
import { COPY, LANGUAGES, type LanguageCode } from './lib/i18n'
import { loadFullRaffleLedger, loadIdentitySuggestions, loadRaffleEntry, loadRaffleLedger } from './lib/ticketing/openMonitor'
import { loadWalletIdentities, type WalletIdentityMap } from './lib/ticketing/identities'
import type { RaffleEntry, RaffleLedger } from './lib/ticketing/types'
import {
  DRAW_NETWORKS,
  isDrawNetworkKey,
  sameAddress,
  type DrawNetworkKey,
  type DrawRunMode,
} from './lib/contracts/luckyDrawNetworks'
import {
  connectInjectedWallet,
  drawBatchWinners,
  drawNextWinner,
  drawPrizeSlotWinner,
  drawPrizeSlotWinners,
  finalizeContractLedger,
  makeDrawStatusSerializable,
  readConnectedWallet,
  readDrawStatus,
  requestContractDraw,
  resetContractDraft,
  type ConnectedWallet,
  type ContractRevealResult,
  type DrawStatus,
} from './lib/wallet/bsc'
import {
  type DrawTransactionKind,
  type DrawTransactionRecord,
  type DrawTransactionRecordsByNetwork,
  type DrawVrfTimingByNetwork,
} from './lib/wallet/drawTransactions'
import {
  requestWalletProviderAnnouncements,
  subscribeWalletProviders,
  type WalletProviderOption,
} from './lib/wallet/providers'
import {
  loadDrawEventHistory,
  type DrawChainEventHistory,
} from './lib/wallet/drawEventHistory'
import { TOTAL_PRIZE_DRAW_SLOTS } from './lib/draw/prizeSlots'

type PageKey = 'tickets' | 'rules' | 'simulator' | 'draw'
type DrawEventHistoryStatus = 'idle' | 'loading' | 'ready' | 'error'

interface DrawEventHistoryState {
  key: string
  status: DrawEventHistoryStatus
  history: DrawChainEventHistory | null
  error: string
}

const ContractDetails = lazy(() => import('./components/ContractDetails').then((module) => ({ default: module.ContractDetails })))
const DrawAdminPanel = lazy(() => import('./components/DrawAdminPanel').then((module) => ({ default: module.DrawAdminPanel })))
const DrawReveal = lazy(() => import('./components/DrawReveal').then((module) => ({ default: module.DrawReveal })))
const PrizeRules = lazy(() => import('./components/PrizeRules').then((module) => ({ default: module.PrizeRules })))
const SimpleDrawSimulator = lazy(() => import('./components/SimpleDrawSimulator').then((module) => ({ default: module.SimpleDrawSimulator })))
const WalletPanel = lazy(() => import('./components/WalletPanel').then((module) => ({ default: module.WalletPanel })))

const LEDGER_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const FULL_LEDGER_PRELOAD_DELAY_MS = 150
const INITIAL_LOADER_MIN_VISIBLE_MS = 1100
const INITIAL_LOADER_EXIT_MS = 540
const SECRET_DRAW_UNLOCK_CLICKS = 3
const DRAW_LEDGER_URI = '/lucky-draw-ledger.json'
const VRF_STATUS_FAST_POLL_MS = 1200
const VRF_STATUS_SLOW_POLL_MS = 3000
const VRF_STATUS_FAST_POLL_COUNT = 30
const INITIAL_PRELOAD_ASSETS = [renaissLogo, heroBackgroundImage, holoCardFrontImage]
const DRAW_TX_STORAGE_KEY = 'renaiss-draw-transactions-v1'
const DRAW_UNLOCK_SESSION_KEY = 'renaiss-draw-unlocked-v1'
const EMPTY_LEDGER_HASH = `0x${'0'.repeat(64)}`
const DRAW_MAINNET_ONLY_START_AT = '2026-06-15T00:00:00+08:00'
const DRAW_MAINNET_ONLY_START_MS = Date.parse(DRAW_MAINNET_ONLY_START_AT)

const PUBLIC_NAV_ITEMS: PageKey[] = ['tickets', 'rules', 'simulator']
type DrawBusyState = 'connect' | 'read' | 'reset' | 'finalize' | 'draw' | 'drawNext' | null

function readStoredDrawTransactions(): DrawTransactionRecordsByNetwork {
  if (typeof window === 'undefined') return {}
  try {
    const rawValue = window.localStorage.getItem(DRAW_TX_STORAGE_KEY)
    if (!rawValue) return {}
    const parsed = JSON.parse(rawValue) as DrawTransactionRecordsByNetwork
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function readStoredDrawUnlocked() {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DRAW_UNLOCK_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function writeStoredDrawUnlocked(value: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (value) {
      window.sessionStorage.setItem(DRAW_UNLOCK_SESSION_KEY, '1')
    } else {
      window.sessionStorage.removeItem(DRAW_UNLOCK_SESSION_KEY)
    }
  } catch {
    // The draw page still works for the current render if sessionStorage is unavailable.
  }
}

function readMainnetOnlyDrawMode() {
  return Date.now() >= DRAW_MAINNET_ONLY_START_MS
}

function createTransactionId(kind: DrawTransactionKind): string {
  return `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function PageHeader({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string
  title: string
  copy: string
}) {
  return (
    <section className="page-hero">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
    </section>
  )
}

function PageChunkLoader() {
  return (
    <section className="app-shell centered">
      <Loader2 className="spin" size={34} />
      <p>Loading raffle view...</p>
    </section>
  )
}

function ledgerCacheKey(value: RaffleLedger | null) {
  if (!value) return ''
  return value.ledgerHash || (value.generatedAt ? String(value.generatedAt) : '')
}

function preloadImageSource(source: string) {
  return new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (!image.decode) {
        resolve()
        return
      }
      void image.decode().catch(() => undefined).finally(resolve)
    }
    image.onerror = () => resolve()
    image.src = source
  })
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function draftDrawStatusFrom(status: DrawStatus): DrawStatus {
  const prizeSlotCount = status.prizeSlotCount > 0n ? status.prizeSlotCount : BigInt(TOTAL_PRIZE_DRAW_SLOTS)
  return makeDrawStatusSerializable({
    ...status,
    finalized: false,
    requested: false,
    fulfilled: false,
    state: 0,
    totalTickets: 0n,
    firstWinningTicket: 0n,
    ledgerHash: EMPTY_LEDGER_HASH,
    prizeSlotCount,
    winnerCount: 0n,
    winnerTickets: [],
    revealedPrizeSlots: [],
    revealedTickets: [],
    winnerTicketsBySlot: Array.from({ length: Number(prizeSlotCount) }, () => 0n),
    reserveTicketsBySlot: Array.from({ length: Number(prizeSlotCount) }, () => []),
  })
}

function drawStatusMatchesLedger(status: DrawStatus | null | undefined, ledger: RaffleLedger | null | undefined) {
  if (!status || !ledger?.ledgerHash) return false
  return (
    status.totalTickets === BigInt(ledger.totalFinalTickets) &&
    status.prizeSlotCount === BigInt(TOTAL_PRIZE_DRAW_SLOTS) &&
    status.ledgerHash.toLowerCase() === ledger.ledgerHash.toLowerCase()
  )
}

function drawStatusHasLedgerMismatch(status: DrawStatus | null | undefined, ledger: RaffleLedger | null | undefined) {
  return Boolean(status?.finalized && ledger && !drawStatusMatchesLedger(status, ledger))
}

function visibleDrawTransactionRecords(
  records: DrawTransactionRecord[],
  contractAddress: string,
  ledgerHash: string | null | undefined,
) {
  const currentContractAddress = contractAddress.toLowerCase()
  const currentLedgerHash = ledgerHash?.toLowerCase() ?? ''
  return records.filter((record) => {
    if (!record.contractAddress || record.contractAddress.toLowerCase() !== currentContractAddress) return false
    if (!record.ledgerHash) return false

    const recordLedgerHash = record.ledgerHash.toLowerCase()
    if (!currentLedgerHash || currentLedgerHash === EMPTY_LEDGER_HASH) {
      return recordLedgerHash === EMPTY_LEDGER_HASH || record.kind === 'reset'
    }

    return recordLedgerHash === currentLedgerHash
  })
}

function drawEventHistoryKey(
  networkKey: DrawNetworkKey,
  contractAddress: string,
  status: DrawStatus | null | undefined,
) {
  if (!status?.finalized || !status.ledgerHash || status.ledgerHash === EMPTY_LEDGER_HASH) return ''
  return [
    networkKey,
    contractAddress.toLowerCase(),
    status.ledgerHash.toLowerCase(),
    status.winnerCount.toString(),
    String(status.state),
  ].join(':')
}

function pageFromHash(hash: string): PageKey | null {
  const key = hash.replace(/^#/, '')
  return PUBLIC_NAV_ITEMS.includes(key as PageKey) || key === 'draw' ? (key as PageKey) : null
}

function initialPageFromLocation(): PageKey {
  if (typeof window === 'undefined') return 'tickets'
  return pageFromHash(window.location.hash) ?? 'tickets'
}

export default function App() {
  const [ledger, setLedger] = useState<RaffleLedger | null>(null)
  const [fullLedger, setFullLedger] = useState<RaffleLedger | null>(null)
  const [loadError, setLoadError] = useState('')
  const [fullLedgerError, setFullLedgerError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<RaffleEntry | null>(null)
  const [page, setPage] = useState<PageKey>(() => initialPageFromLocation())
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null)
  const [walletError, setWalletError] = useState('')
  const [drawRunMode, setDrawRunMode] = useState<DrawRunMode>('showcase')
  const [drawStatusByNetwork, setDrawStatusByNetwork] = useState<Partial<Record<DrawNetworkKey, DrawStatus>>>({})
  const [drawTxRecordsByNetwork, setDrawTxRecordsByNetwork] = useState<DrawTransactionRecordsByNetwork>(() => readStoredDrawTransactions())
  const [drawVrfTimingByNetwork, setDrawVrfTimingByNetwork] = useState<DrawVrfTimingByNetwork>({})
  const [drawEventHistoryByNetwork, setDrawEventHistoryByNetwork] = useState<Partial<Record<DrawNetworkKey, DrawEventHistoryState>>>({})
  const [drawMessage, setDrawMessage] = useState('')
  const [drawBusy, setDrawBusy] = useState<DrawBusyState>(null)
  const [walletIdentities, setWalletIdentities] = useState<WalletIdentityMap>({})
  const [language, setLanguage] = useState<LanguageCode>('zh-TW')
  const [lastLedgerRefreshAt, setLastLedgerRefreshAt] = useState<number>(0)
  const [nextLedgerRefreshAt, setNextLedgerRefreshAt] = useState<number>(0)
  const [drawUnlocked, setDrawUnlocked] = useState(() => readStoredDrawUnlocked())
  const [walletProviderOptions, setWalletProviderOptions] = useState<WalletProviderOption[]>([])
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false)
  const [walletSelectorNetworkKey, setWalletSelectorNetworkKey] = useState<DrawNetworkKey>('mainnet')
  const [selectedWalletProvider, setSelectedWalletProvider] = useState<WalletProviderOption | null>(null)
  const [mainnetOnlyDrawMode, setMainnetOnlyDrawMode] = useState(() => readMainnetOnlyDrawMode())
  const [initialAssetsReady, setInitialAssetsReady] = useState(false)
  const [initialCoverPaintReady, setInitialCoverPaintReady] = useState(false)
  const [initialLoaderVisible, setInitialLoaderVisible] = useState(true)
  const [initialLoaderMounted, setInitialLoaderMounted] = useState(true)
  const [initialLoaderStartedAt] = useState(() => Date.now())
  const drawUnlockHitsRef = useRef(0)
  const drawEventHistoryRequestKeyRef = useRef('')
  const entryRequestRef = useRef(0)
  const fullLedgerPreloadKeyRef = useRef('')
  const copy = COPY[language]
  const activePage: PageKey = page === 'draw' && !drawUnlocked ? 'simulator' : page
  const needsFullLedger = activePage === 'simulator' || activePage === 'draw'
  const summaryLedgerKey = ledgerCacheKey(ledger)
  const fullLedgerKey = ledgerCacheKey(fullLedger)
  const fullLedgerIsCurrent = Boolean(fullLedger && (!summaryLedgerKey || !fullLedgerKey || summaryLedgerKey === fullLedgerKey))
  const currentFullLedger = fullLedgerIsCurrent ? fullLedger : null
  const displayLedger = needsFullLedger ? currentFullLedger ?? ledger : ledger
  const activeDrawNetworkKey: DrawNetworkKey = isDrawNetworkKey(drawRunMode) ? drawRunMode : 'mainnet'
  const activeDrawNetwork = DRAW_NETWORKS[activeDrawNetworkKey]
  const activeStoredDrawStatus = drawStatusByNetwork[activeDrawNetworkKey] ?? null
  const activeWinnerTicketsBySlot = activeStoredDrawStatus?.winnerTicketsBySlot ?? []
  const activeReserveTicketsBySlot = activeStoredDrawStatus?.reserveTicketsBySlot ?? []
  const activeRevealedPrizeSlots = activeStoredDrawStatus?.revealedPrizeSlots ?? []
  const activeDrawStatus = activeStoredDrawStatus
  const activeDrawLedgerHash = activeDrawStatus?.ledgerHash ?? ''
  const activeDrawTxRecords = visibleDrawTransactionRecords(
    drawTxRecordsByNetwork[activeDrawNetworkKey] ?? [],
    activeDrawNetwork.contractAddress,
    activeDrawLedgerHash,
  )
  const activeDrawEventHistoryKey = drawEventHistoryKey(activeDrawNetworkKey, activeDrawNetwork.contractAddress, activeDrawStatus)
  const activeDrawEventHistoryState = drawEventHistoryByNetwork[activeDrawNetworkKey]
  const activeDrawEventHistory =
    activeDrawEventHistoryState?.key === activeDrawEventHistoryKey ? activeDrawEventHistoryState : null
  const activeDrawVrfTiming = drawVrfTimingByNetwork[activeDrawNetworkKey] ?? null
  const isActiveContractOwner = sameAddress(wallet?.address, activeDrawStatus?.ownerAddress)
  const isActiveAuthorizedOperator = isWalletDrawAdmin(wallet, activeDrawStatus)
  const activeLedgerForContractCheck = currentFullLedger ?? ledger
  const isActiveContractLedgerMismatch = drawStatusHasLedgerMismatch(activeDrawStatus, activeLedgerForContractCheck)

  useEffect(() => subscribeWalletProviders(setWalletProviderOptions), [])

  useEffect(() => {
    const syncMainnetOnlyMode = () => setMainnetOnlyDrawMode(readMainnetOnlyDrawMode())
    syncMainnetOnlyMode()
    const intervalId = window.setInterval(syncMainnetOnlyMode, 15_000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!mainnetOnlyDrawMode || drawRunMode === 'mainnet') return undefined
    const timeoutId = window.setTimeout(() => {
      setDrawRunMode('mainnet')
      setDrawMessage('')
      setDrawBusy((current) => (current === 'read' ? null : current))
    }, 0)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [drawRunMode, mainnetOnlyDrawMode])

  useEffect(() => {
    const ethereum = wallet?.injectedProvider ?? selectedWalletProvider?.provider
    if (!ethereum?.on) return undefined

    let cancelled = false

    async function syncInjectedWallet(trigger: 'chain_changed' | 'accounts_changed') {
      setDrawMessage('')
      setDrawStatusByNetwork({})
      try {
        const nextWallet = await readConnectedWallet(ethereum, wallet?.walletName ?? selectedWalletProvider?.name)
        if (cancelled) return
        setWallet(nextWallet)
        trackEvent('wallet_connect_result', {
          chain_id: nextWallet?.chainId.toString() ?? '',
          status: nextWallet ? 'connected' : 'disconnected',
          trigger,
        })
      } catch (error) {
        if (cancelled) return
        setWallet(null)
        setWalletError(error instanceof Error ? error.message : copy.walletPanel.connectionFailed)
        trackEvent('wallet_connect_result', {
          status: 'error',
          trigger,
        })
      }
    }

    const handleChainChanged = () => {
      void syncInjectedWallet('chain_changed')
    }

    const handleAccountsChanged = () => {
      void syncInjectedWallet('accounts_changed')
    }

    ethereum.on('chainChanged', handleChainChanged)
    ethereum.on('accountsChanged', handleAccountsChanged)

    return () => {
      cancelled = true
      ethereum.removeListener?.('chainChanged', handleChainChanged)
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged)
    }
  }, [copy.walletPanel.connectionFailed, selectedWalletProvider, wallet?.injectedProvider, wallet?.walletName])
  const initialCoverAssetsReady = Boolean(ledger && displayLedger && initialAssetsReady)
  const initialExperienceReady = initialCoverAssetsReady && initialCoverPaintReady
  const visibleNavItems = useMemo<PageKey[]>(
    () => (drawUnlocked ? [...PUBLIC_NAV_ITEMS, 'draw'] : PUBLIC_NAV_ITEMS),
    [drawUnlocked],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAW_TX_STORAGE_KEY, JSON.stringify(drawTxRecordsByNetwork))
    } catch {
      // Transaction links are still shown in memory if localStorage is unavailable.
    }
  }, [drawTxRecordsByNetwork])

  useEffect(() => {
    if (activePage !== 'draw' || !activeDrawEventHistoryKey || !activeDrawLedgerHash) return undefined
    if (drawEventHistoryRequestKeyRef.current === activeDrawEventHistoryKey) return undefined
    drawEventHistoryRequestKeyRef.current = activeDrawEventHistoryKey

    let alive = true
    let finished = false
    setDrawEventHistoryByNetwork((current) => ({
      ...current,
      [activeDrawNetworkKey]: {
        key: activeDrawEventHistoryKey,
        status: 'loading',
        history: null,
        error: '',
      },
    }))

    void loadDrawEventHistory({
      networkKey: activeDrawNetworkKey,
      ledgerHash: activeDrawLedgerHash,
    })
      .then((history) => {
        finished = true
        if (!alive) return
        setDrawEventHistoryByNetwork((current) => ({
          ...current,
          [activeDrawNetworkKey]: {
            key: activeDrawEventHistoryKey,
            status: 'ready',
            history,
            error: '',
          },
        }))
      })
      .catch((error) => {
        finished = true
        if (!alive) return
        setDrawEventHistoryByNetwork((current) => ({
          ...current,
          [activeDrawNetworkKey]: {
            key: activeDrawEventHistoryKey,
            status: 'error',
            history: null,
            error: error instanceof Error ? error.message : 'Could not load on-chain draw event history.',
          },
        }))
      })

    return () => {
      alive = false
      if (!finished && drawEventHistoryRequestKeyRef.current === activeDrawEventHistoryKey) {
        drawEventHistoryRequestKeyRef.current = ''
      }
    }
  }, [activeDrawEventHistoryKey, activeDrawLedgerHash, activeDrawNetworkKey, activePage])

  useEffect(() => {
    initializeAnalytics()
  }, [])

  useEffect(() => {
    let alive = true

    void Promise.all(INITIAL_PRELOAD_ASSETS.map((source) => preloadImageSource(source))).then(() => {
      if (alive) setInitialAssetsReady(true)
    })

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!initialCoverAssetsReady) return undefined

    let alive = true
    let firstFrameId = 0
    let secondFrameId = 0

    const markAfterPaint = () => {
      firstFrameId = window.requestAnimationFrame(() => {
        secondFrameId = window.requestAnimationFrame(() => {
          if (alive) setInitialCoverPaintReady(true)
        })
      })
    }

    if (document.fonts?.ready) {
      void document.fonts.ready.catch(() => undefined).finally(() => {
        if (alive) markAfterPaint()
      })
    } else {
      markAfterPaint()
    }

    return () => {
      alive = false
      window.cancelAnimationFrame(firstFrameId)
      window.cancelAnimationFrame(secondFrameId)
    }
  }, [initialCoverAssetsReady])

  useEffect(() => {
    if (!initialExperienceReady) return undefined

    const elapsed = Date.now() - initialLoaderStartedAt
    const timeoutId = window.setTimeout(() => {
      setInitialLoaderVisible(false)
    }, Math.max(0, INITIAL_LOADER_MIN_VISIBLE_MS - elapsed))

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [initialExperienceReady, initialLoaderStartedAt])

  useEffect(() => {
    if (initialLoaderVisible) return undefined

    const timeoutId = window.setTimeout(() => {
      setInitialLoaderMounted(false)
    }, INITIAL_LOADER_EXIT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [initialLoaderVisible])

  useEffect(() => {
    trackPageView(activePage)
  }, [activePage])

  useEffect(() => {
    const syncPageFromHash = () => {
      const nextPage = pageFromHash(window.location.hash)
      if (nextPage) setPage(nextPage)
    }

    window.addEventListener('hashchange', syncPageFromHash)
    window.addEventListener('popstate', syncPageFromHash)

    return () => {
      window.removeEventListener('hashchange', syncPageFromHash)
      window.removeEventListener('popstate', syncPageFromHash)
    }
  }, [])

  useEffect(() => {
    let alive = true

    async function refreshLedger() {
      try {
        const value = await loadRaffleLedger()
        if (!alive) return
        setLedger(value)
        const now = Date.now()
        setLastLedgerRefreshAt(now)
        setNextLedgerRefreshAt(now + LEDGER_REFRESH_INTERVAL_MS)
      } catch (error) {
        if (!alive) return
        setLoadError(error instanceof Error ? error.message : 'Could not load raffle data.')
      }
    }

    void refreshLedger()
    const intervalId = window.setInterval(() => {
      void refreshLedger()
    }, LEDGER_REFRESH_INTERVAL_MS)

    return () => {
      alive = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!needsFullLedger || fullLedgerIsCurrent) return undefined
    let alive = true

    async function refreshFullLedger() {
      setFullLedgerError('')
      try {
        const value = await loadFullRaffleLedger({
          force: Boolean(fullLedger && !fullLedgerIsCurrent),
          version: summaryLedgerKey,
        })
        if (alive) setFullLedger(value)
      } catch (error) {
        if (alive) setFullLedgerError(error instanceof Error ? error.message : 'Could not load full raffle ledger.')
      }
    }

    void refreshFullLedger()

    return () => {
      alive = false
    }
  }, [fullLedger, fullLedgerIsCurrent, needsFullLedger, summaryLedgerKey])

  useEffect(() => {
    if (!needsFullLedger || !ledger || fullLedgerIsCurrent) return undefined

    const preloadKey = summaryLedgerKey || 'current'
    if (fullLedgerPreloadKeyRef.current === preloadKey) return undefined
    fullLedgerPreloadKeyRef.current = preloadKey

    let alive = true
    const timeoutId = window.setTimeout(() => {
      setFullLedgerError('')
      void loadFullRaffleLedger({
        force: Boolean(fullLedger && !fullLedgerIsCurrent),
        version: summaryLedgerKey,
      })
        .then((value) => {
          if (alive) setFullLedger(value)
        })
        .catch((error) => {
          if (alive) setFullLedgerError(error instanceof Error ? error.message : 'Could not load full raffle ledger.')
        })
    }, FULL_LEDGER_PRELOAD_DELAY_MS)

    return () => {
      alive = false
      window.clearTimeout(timeoutId)
    }
  }, [fullLedger, fullLedgerIsCurrent, ledger, needsFullLedger, summaryLedgerKey])

  useEffect(() => {
    let alive = true

    async function refreshIdentities() {
      const value = await loadWalletIdentities()
      if (alive) setWalletIdentities(value)
    }

    void refreshIdentities()

    return () => {
      alive = false
    }
  }, [])

  async function resolveTicketEntry(value: string) {
    const requestId = entryRequestRef.current + 1
    entryRequestRef.current = requestId
    const nextQuery = value.trim()
    setSelectedEntry(null)
    if (!nextQuery) return null

    const entry = await loadRaffleEntry(nextQuery)
    if (entryRequestRef.current === requestId) setSelectedEntry(entry)
    return entry
  }

  const loadTicketEntryIntervals = useCallback(async (value: string, request: { offset: number; limit: number | 'all' }) => {
    return loadRaffleEntry(value, {
      intervalOffset: request.offset,
      intervalLimit: request.limit,
    })
  }, [])

  function handlePageChange(nextPage: PageKey) {
    if (window.location.hash !== `#${nextPage}`) {
      window.history.pushState(null, '', `#${nextPage}`)
    }
    setPage(nextPage)
    trackEvent('navigation_select', {
      draw_unlocked: drawUnlocked,
      page: nextPage,
    })
  }

  function handleLanguageChange(nextLanguage: LanguageCode) {
    setLanguage(nextLanguage)
    trackEvent('language_change', {
      language: nextLanguage,
    })
  }

  function handleDrawRunModeChange(nextMode: DrawRunMode) {
    if (mainnetOnlyDrawMode && nextMode !== 'mainnet') {
      setDrawRunMode('mainnet')
      setDrawMessage('')
      setDrawBusy((current) => (current === 'read' ? null : current))
      trackEvent('draw_run_mode_change', {
        mode: 'mainnet',
        locked_after: DRAW_MAINNET_ONLY_START_AT,
      })
      return
    }
    setDrawRunMode(nextMode)
    setDrawMessage('')
    setDrawBusy((current) => (current === 'read' ? null : current))
    trackEvent('draw_run_mode_change', {
      mode: nextMode,
    })
  }

  function disconnectWallet() {
    trackEvent('wallet_disconnect', {
      address: wallet?.address ?? '',
      network: activeDrawNetworkKey,
    })
    setWallet(null)
    setSelectedWalletProvider(null)
    setWalletError('')
    setWalletSelectorOpen(false)
    setDrawMessage('')
    setDrawStatusByNetwork({})
  }

  function isWalletDrawAdmin(currentWallet: ConnectedWallet | null, status: DrawStatus | null) {
    if (!currentWallet || !status) return false
    return Boolean(
      status.connectedWalletIsAdmin ||
        sameAddress(currentWallet.address, status.ownerAddress) ||
        sameAddress(currentWallet.address, status.drawOperatorAddress),
    )
  }

  function drawTransactionKindLabel(kind: DrawTransactionKind) {
    if (kind === 'reset') return copy.walletPanel.resetRound
    if (kind === 'finalize') return copy.walletPanel.finalizeLedger
    if (kind === 'request') return copy.drawReveal.requestRound
    return copy.walletPanel.drawNext
  }

  function beginDrawTransaction(
    networkKey: DrawNetworkKey,
    kind: DrawTransactionKind,
    detail?: string,
    scope?: { ledgerHash?: string },
  ) {
    const id = createTransactionId(kind)
    const startedAt = Date.now()
    const label = drawTransactionKindLabel(kind)
    const network = DRAW_NETWORKS[networkKey]
    const initialRecord: DrawTransactionRecord = {
      id,
      networkKey,
      contractAddress: network.contractAddress,
      ledgerHash: scope?.ledgerHash ?? drawStatusByNetwork[networkKey]?.ledgerHash ?? EMPTY_LEDGER_HASH,
      kind,
      status: 'awaiting-signature',
      startedAt,
      detail,
    }

    setDrawTxRecordsByNetwork((current) => ({
      ...current,
      [networkKey]: [initialRecord, ...(current[networkKey] ?? [])],
    }))
    setDrawMessage(`${label}: ${copy.walletPanel.txAwaitingSignature}`)

    function updateRecord(update: Partial<DrawTransactionRecord>) {
      setDrawTxRecordsByNetwork((current) => ({
        ...current,
        [networkKey]: (current[networkKey] ?? []).map((record) => (record.id === id ? { ...record, ...update } : record)),
      }))
    }

    return {
      id,
      fail(error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        updateRecord({
          error: errorMessage,
          status: 'failed',
        })
        setDrawMessage(`${label}: ${copy.walletPanel.txFailed}: ${errorMessage}`)
      },
      submit(hash: string) {
        updateRecord({
          hash,
          status: 'pending',
          submittedAt: Date.now(),
        })
        setDrawMessage(`${label}: ${copy.walletPanel.txPending}: ${hash}`)
      },
      confirm(hash: string) {
        updateRecord({
          hash,
          confirmedAt: Date.now(),
          status: 'confirmed',
        })
        setDrawMessage(`${label}: ${copy.walletPanel.txConfirmed}: ${hash}`)
      },
      keepOnlyThisRecord() {
        setDrawTxRecordsByNetwork((current) => ({
          ...current,
          [networkKey]: (current[networkKey] ?? []).filter((record) => record.id === id),
        }))
      },
    }
  }

  function updateVrfTimingFromStatus(networkKey: DrawNetworkKey, nextStatus: DrawStatus) {
    if (!nextStatus.requested) return
    const now = Date.now()
    setDrawVrfTimingByNetwork((current) => {
      const existing = current[networkKey] ?? {}
      let nextTiming = existing
      if (nextStatus.state < 3 && !existing.pendingObservedAt && !existing.randomnessReadyAt) {
        nextTiming = { ...nextTiming, pendingObservedAt: now }
      }
      if (nextStatus.state >= 3 && !existing.randomnessReadyAt) {
        nextTiming = { ...nextTiming, randomnessReadyAt: now }
      }
      return nextTiming === existing ? current : { ...current, [networkKey]: nextTiming }
    })
  }

  function markVrfRequestConfirmed(networkKey: DrawNetworkKey) {
    const now = Date.now()
    setDrawVrfTimingByNetwork((current) => ({
      ...current,
      [networkKey]: {
        ...(current[networkKey] ?? {}),
        pendingObservedAt: now,
        requestConfirmedAt: now,
        randomnessReadyAt: undefined,
      },
    }))
  }

  function clearVrfTiming(networkKey: DrawNetworkKey) {
    setDrawVrfTimingByNetwork((current) => {
      const next = { ...current }
      delete next[networkKey]
      return next
    })
  }

  async function readStatusForNetwork(
    networkKey: DrawNetworkKey,
    activeWallet: ConnectedWallet | null = wallet,
  ): Promise<DrawStatus> {
    const network = DRAW_NETWORKS[networkKey]
    const providerForSelectedNetwork = activeWallet?.chainId === network.chainId ? activeWallet.provider : undefined
    const nextStatus = await readDrawStatus(providerForSelectedNetwork, network.contractAddress, networkKey, activeWallet?.address ?? '')
    setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: nextStatus }))
    updateVrfTimingFromStatus(networkKey, nextStatus)
    return nextStatus
  }

  async function readStatusForWallet(activeWallet: ConnectedWallet, networkKey: DrawNetworkKey): Promise<DrawStatus> {
    return readStatusForNetwork(networkKey, activeWallet)
  }

  async function readStatusForWalletUntil(
    activeWallet: ConnectedWallet,
    networkKey: DrawNetworkKey,
    predicate: (status: DrawStatus) => boolean,
    attempts = 8,
  ): Promise<DrawStatus> {
    let nextStatus = await readStatusForWallet(activeWallet, networkKey)
    for (let attempt = 1; attempt < attempts && !predicate(nextStatus); attempt += 1) {
      await wait(700)
      nextStatus = await readStatusForWallet(activeWallet, networkKey)
    }
    return nextStatus
  }

  useEffect(() => {
    if (activePage !== 'draw') return undefined
    if (!wallet) return undefined
    if (!activeStoredDrawStatus?.requested || activeStoredDrawStatus.fulfilled || activeStoredDrawStatus.state >= 3) return undefined

    let cancelled = false
    let pollTimeoutId = 0
    let pollCount = 0
    let inFlight = false
    const activeWallet = wallet
    const networkKey = activeDrawNetworkKey
    const network = DRAW_NETWORKS[networkKey]

    async function pollDrawStatus() {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const nextStatus = await readDrawStatus(activeWallet.provider, network.contractAddress, networkKey, activeWallet.address)
        if (cancelled) return
        setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: nextStatus }))
        updateVrfTimingFromStatus(networkKey, nextStatus)
        if (nextStatus.state >= 3 || nextStatus.fulfilled) {
          trackEvent('draw_status_read', {
            network: networkKey,
            status: 'randomness_ready',
            trigger: 'auto_poll',
            poll_count: pollCount + 1,
          })
          return
        }
      } catch {
        if (cancelled) return
        trackEvent('draw_status_read', {
          network: networkKey,
          status: 'error',
          trigger: 'auto_poll',
          poll_count: pollCount + 1,
        })
      } finally {
        inFlight = false
      }

      if (cancelled) return
      pollCount += 1
      const delay = pollCount < VRF_STATUS_FAST_POLL_COUNT ? VRF_STATUS_FAST_POLL_MS : VRF_STATUS_SLOW_POLL_MS
      pollTimeoutId = window.setTimeout(pollDrawStatus, delay)
    }

    pollTimeoutId = window.setTimeout(pollDrawStatus, VRF_STATUS_FAST_POLL_MS)

    return () => {
      cancelled = true
      window.clearTimeout(pollTimeoutId)
    }
  }, [
    activeDrawNetworkKey,
    activePage,
    activeStoredDrawStatus?.fulfilled,
    activeStoredDrawStatus?.requested,
    activeStoredDrawStatus?.state,
    wallet,
  ])

  useEffect(() => {
    if (activePage !== 'draw' && activePage !== 'tickets') return undefined
    if (drawBusy !== null) return undefined
    let cancelled = false
    const providerForSelectedNetwork = wallet?.chainId === activeDrawNetwork.chainId ? wallet.provider : undefined
    const walletAddress = wallet?.chainId === activeDrawNetwork.chainId ? wallet.address : ''

    async function syncSelectedNetworkStatus() {
      try {
        const nextStatus = await readDrawStatus(providerForSelectedNetwork, activeDrawNetwork.contractAddress, activeDrawNetworkKey, walletAddress)
        if (cancelled) return
        setDrawStatusByNetwork((current) => ({ ...current, [activeDrawNetworkKey]: nextStatus }))
        updateVrfTimingFromStatus(activeDrawNetworkKey, nextStatus)
      } catch {
        if (cancelled) return
        trackEvent('draw_status_read', {
          network: activeDrawNetworkKey,
          status: 'error',
          trigger: walletAddress ? 'auto_sync' : 'public_auto_sync',
        })
      }
    }

    const timeoutId = window.setTimeout(() => {
      void syncSelectedNetworkStatus()
    }, activePage === 'draw' ? 300 : 900)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [activeDrawNetwork.chainId, activeDrawNetwork.contractAddress, activeDrawNetworkKey, activePage, drawBusy, wallet])

  function openWalletSelector(networkKey = activeDrawNetworkKey) {
    setWalletSelectorNetworkKey(networkKey)
    setWalletSelectorOpen(true)
    requestWalletProviderAnnouncements()
  }

  function refreshWalletProviders() {
    requestWalletProviderAnnouncements()
  }

  async function connectBscWallet(networkKey = activeDrawNetworkKey, providerOption?: WalletProviderOption) {
    setWalletError('')
    setDrawMessage('')
    setDrawBusy('connect')
    trackEvent('wallet_connect', {
      network: networkKey,
      provider: providerOption?.name ?? selectedWalletProvider?.name ?? '',
    })
    let walletConnected = false
    try {
      const selectedProvider = providerOption ?? selectedWalletProvider
      const nextWallet = await connectInjectedWallet(networkKey, selectedProvider?.provider, selectedProvider?.name)
      walletConnected = true
      setSelectedWalletProvider(selectedProvider ?? null)
      setWallet(nextWallet)
      writeStoredDrawUnlocked(true)
      setDrawUnlocked(true)
      setPage('draw')
      setWalletSelectorOpen(false)
      trackEvent('wallet_connect_result', {
        network: networkKey,
        provider: selectedProvider?.name ?? nextWallet.walletName ?? '',
        status: 'success',
      })
      try {
        await readStatusForWallet(nextWallet, networkKey)
        trackEvent('draw_status_read', {
          network: networkKey,
          provider: selectedProvider?.name ?? nextWallet.walletName ?? '',
          status: 'success',
          trigger: 'wallet_connect',
        })
      } catch (error) {
        trackEvent('draw_status_read', {
          network: networkKey,
          status: 'error',
          trigger: 'wallet_connect',
        })
        throw error
      }
    } catch (error) {
      if (!walletConnected) {
        trackEvent('wallet_connect_result', {
          network: networkKey,
          provider: providerOption?.name ?? selectedWalletProvider?.name ?? '',
          status: 'error',
        })
      }
      setWalletError(error instanceof Error ? error.message : copy.walletPanel.connectionFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function refreshDrawStatus(networkKey = activeDrawNetworkKey) {
    setDrawBusy('read')
    setDrawMessage(`${copy.walletPanel.read}: ${copy.common.pending}`)
    try {
      await readStatusForNetwork(networkKey, wallet)
      setDrawMessage(`${copy.walletPanel.read}: ${copy.walletPanel.statusUpdated}`)
      trackEvent('draw_status_read', {
        network: networkKey,
        status: 'success',
        trigger: wallet ? 'manual_refresh' : 'public_manual_refresh',
      })
    } catch (error) {
      trackEvent('draw_status_read', {
        network: networkKey,
        status: 'error',
        trigger: 'manual_refresh',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.readFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function resetContractRound(networkKey = activeDrawNetworkKey): Promise<boolean> {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'blocked_no_wallet',
      })
      return false
    }
    const network = DRAW_NETWORKS[networkKey]
    const currentStatus = drawStatusByNetwork[networkKey] ?? (await readStatusForWallet(wallet, networkKey))
    if (currentStatus.state === 2) {
      setDrawMessage(copy.walletPanel.resetBlockedDuringRequest)
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'blocked_vrf_pending',
      })
      return false
    }
    if (!currentStatus.finalized && currentStatus.winnerCount === 0n) {
      setDrawMessage(copy.walletPanel.lockLedgerFirst)
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'blocked_nothing_to_reset',
      })
      return false
    }
    if (!window.confirm(copy.walletPanel.resetConfirm)) {
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'cancelled',
      })
      return false
    }

    setDrawBusy('reset')
    setDrawMessage('')
    trackEvent('draw_reset', {
      network: networkKey,
      status: 'start',
    })
    const transaction = beginDrawTransaction(networkKey, 'reset', undefined, { ledgerHash: EMPTY_LEDGER_HASH })
    const signerProvider = wallet.injectedProvider ?? wallet.provider
    try {
      const hash = await resetContractDraft(signerProvider, network.contractAddress, networkKey, transaction.submit)
      transaction.confirm(hash)
      transaction.keepOnlyThisRecord()
      clearVrfTiming(networkKey)
      const optimisticDraftStatus = draftDrawStatusFrom(currentStatus)
      setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: optimisticDraftStatus }))
      const nextStatus = await readStatusForWalletUntil(wallet, networkKey, (status) => status.state === 0 && !status.finalized && status.winnerCount === 0n)
      if (nextStatus.state !== 0 || nextStatus.finalized || nextStatus.winnerCount !== 0n) {
        setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: optimisticDraftStatus }))
      }
      setDrawMessage(`${copy.walletPanel.resetSent}: ${hash}`)
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'success',
      })
      return true
    } catch (error) {
      transaction.fail(error)
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'error',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.resetFailed)
      return false
    } finally {
      setDrawBusy(null)
    }
  }

  async function lockLedgerRound(networkKey = activeDrawNetworkKey) {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'blocked_no_wallet',
      })
      return
    }
    const network = DRAW_NETWORKS[networkKey]
    const currentStatus = drawStatusByNetwork[networkKey] ?? (await readStatusForWallet(wallet, networkKey))
    const ledgerForDraw = currentFullLedger ?? ledger
    if (!ledgerForDraw?.ledgerHash) {
      setDrawMessage(copy.walletPanel.ledgerHashMissing)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'blocked_missing_ledger_hash',
      })
      return
    }
    const ledgerHashForDraw = ledgerForDraw.ledgerHash
    if (currentStatus?.requested) {
      setDrawMessage(copy.walletPanel.finalizeBlockedAfterRequest)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'blocked_round_started',
      })
      return
    }
    setDrawBusy('finalize')
    setDrawMessage('')
    trackEvent('draw_finalize', {
      network: networkKey,
      status: 'start',
    })
    const transaction = beginDrawTransaction(networkKey, 'finalize', undefined, { ledgerHash: ledgerHashForDraw })
    const signerProvider = wallet.injectedProvider ?? wallet.provider
    try {
      const hash = await finalizeContractLedger(
        signerProvider,
        network.contractAddress,
        networkKey,
        ledgerHashForDraw,
        ledgerForDraw.totalFinalTickets,
        TOTAL_PRIZE_DRAW_SLOTS,
        DRAW_LEDGER_URI,
        transaction.submit,
      )
      transaction.confirm(hash)
      await readStatusForWalletUntil(
        wallet,
        networkKey,
        (status) =>
          status.finalized &&
          status.totalTickets === BigInt(ledgerForDraw.totalFinalTickets) &&
          status.prizeSlotCount === BigInt(TOTAL_PRIZE_DRAW_SLOTS) &&
          status.ledgerHash.toLowerCase() === ledgerHashForDraw.toLowerCase(),
      )
      setDrawMessage(`${copy.walletPanel.finalizeSent}: ${hash}`)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'success',
      })
    } catch (error) {
      transaction.fail(error)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'error',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.finalizeFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function requestDrawRound(networkKey = activeDrawNetworkKey) {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'blocked_no_wallet',
      })
      return
    }
    const network = DRAW_NETWORKS[networkKey]
    const currentStatus = drawStatusByNetwork[networkKey] ?? (await readStatusForWallet(wallet, networkKey))
    if (!currentStatus?.finalized) {
      setDrawMessage(copy.walletPanel.lockLedgerFirst)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'blocked_not_finalized',
      })
      return
    }
    if (currentStatus.requested) {
      setDrawMessage(copy.walletPanel.vrfAlreadyRequested)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'blocked_already_requested',
      })
      return
    }
    if (currentStatus.vrfSubscriptionError) {
      setDrawMessage(currentStatus.vrfSubscriptionError)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'blocked_vrf_config_error',
      })
      return
    }
    if (drawStatusHasLedgerMismatch(currentStatus, currentFullLedger ?? ledger)) {
      setDrawMessage(copy.walletPanel.contractTotalMismatch)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'blocked_ledger_mismatch',
      })
      return
    }
    setDrawBusy('draw')
    setDrawMessage('')
    trackEvent('draw_request', {
      network: networkKey,
      status: 'start',
    })
    const transaction = beginDrawTransaction(networkKey, 'request', undefined, { ledgerHash: currentStatus.ledgerHash })
    const signerProvider = wallet.injectedProvider ?? wallet.provider
    try {
      const hash = await requestContractDraw(signerProvider, network.contractAddress, networkKey, transaction.submit)
      transaction.confirm(hash)
      markVrfRequestConfirmed(networkKey)
      await readStatusForWalletUntil(wallet, networkKey, (status) => status.requested)
      setDrawMessage(`${copy.walletPanel.drawSent}: ${hash}`)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'success',
      })
    } catch (error) {
      transaction.fail(error)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'error',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.drawFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  function revealResultsFromStatus(status: DrawStatus, previousRevealCount: number): ContractRevealResult[] {
    return status.revealedPrizeSlots
      .slice(previousRevealCount)
      .map((slotIndexValue, index) => {
        const prizeSlotIndex = Number(slotIndexValue)
        const ticket = status.winnerTicketsBySlot[prizeSlotIndex] ?? status.revealedTickets[previousRevealCount + index] ?? 0n
        const reserveTickets = status.reserveTicketsBySlot[prizeSlotIndex] ?? []
        return { prizeSlotIndex, reserveTickets, ticket }
      })
      .filter((result) => Number.isInteger(result.prizeSlotIndex) && result.prizeSlotIndex >= 0 && result.ticket > 0n)
  }

  async function drawContractPrizeSlots(prizeSlotIndexes: number[], networkKey = activeDrawNetworkKey): Promise<ContractRevealResult[]> {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: prizeSlotIndexes.length,
        prize_slot_indexes: prizeSlotIndexes.join(','),
        status: 'blocked_no_wallet',
      })
      return []
    }

    const network = DRAW_NETWORKS[networkKey]
    const currentStatus = drawStatusByNetwork[networkKey] ?? (await readStatusForWallet(wallet, networkKey))
    if (currentStatus?.vrfSubscriptionError) {
      setDrawMessage(currentStatus.vrfSubscriptionError)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: prizeSlotIndexes.length,
        prize_slot_indexes: prizeSlotIndexes.join(','),
        status: 'blocked_vrf_config_error',
      })
      return []
    }
    if (drawStatusHasLedgerMismatch(currentStatus, currentFullLedger ?? ledger)) {
      setDrawMessage(copy.walletPanel.contractTotalMismatch)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: prizeSlotIndexes.length,
        prize_slot_indexes: prizeSlotIndexes.join(','),
        status: 'blocked_ledger_mismatch',
      })
      return []
    }
    if (!currentStatus?.requested) {
      setDrawMessage(copy.walletPanel.requestVrfFirst)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: prizeSlotIndexes.length,
        prize_slot_indexes: prizeSlotIndexes.join(','),
        status: 'blocked_vrf_not_requested',
      })
      return []
    }
    if (currentStatus.state < 3) {
      setDrawMessage(copy.drawReveal.waitingForVrf)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: prizeSlotIndexes.length,
        prize_slot_indexes: prizeSlotIndexes.join(','),
        status: 'blocked_vrf_not_ready',
      })
      return []
    }

    const safePrizeSlotIndexes = Array.from(
      new Set(
        prizeSlotIndexes
          .map((slotIndex) => Math.floor(slotIndex))
          .filter((slotIndex) => Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < TOTAL_PRIZE_DRAW_SLOTS),
      ),
    )
    if (safePrizeSlotIndexes.length === 0) {
      setDrawMessage(copy.drawReveal.noContractTickets)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: 0,
        prize_slot_indexes: prizeSlotIndexes.join(','),
        status: 'blocked_invalid_prize_slots',
      })
      return []
    }

    const previousRevealCount = currentStatus.revealedPrizeSlots.length
    if (!currentStatus.supportsSelectablePrizeSlots) {
      const isNextSequentialBatch = safePrizeSlotIndexes.every((slotIndex, index) => slotIndex === previousRevealCount + index)
      if (!isNextSequentialBatch) {
        setDrawMessage(copy.drawReveal.selectableOrderUnavailable)
        trackEvent('draw_next', {
          network: networkKey,
          requested_count: safePrizeSlotIndexes.length,
          prize_slot_indexes: safePrizeSlotIndexes.join(','),
          status: 'blocked_legacy_contract_order',
        })
        return []
      }
    }

    setDrawBusy('drawNext')
    setDrawMessage('')
    trackEvent('draw_next', {
      network: networkKey,
      requested_count: safePrizeSlotIndexes.length,
      prize_slot_indexes: safePrizeSlotIndexes.join(','),
      status: 'start',
    })
    const transaction = beginDrawTransaction(
      networkKey,
      'reveal',
      safePrizeSlotIndexes.map((slotIndex) => `${copy.drawReveal.slotLabel} #${slotIndex + 1}`).join(', '),
      { ledgerHash: currentStatus.ledgerHash },
    )
    const signerProvider = wallet.injectedProvider ?? wallet.provider
    try {
      const hash = currentStatus.supportsSelectablePrizeSlots
        ? safePrizeSlotIndexes.length === 1
          ? await drawPrizeSlotWinner(signerProvider, network.contractAddress, networkKey, safePrizeSlotIndexes[0], transaction.submit)
          : await drawPrizeSlotWinners(signerProvider, network.contractAddress, networkKey, safePrizeSlotIndexes, transaction.submit)
        : safePrizeSlotIndexes.length === 1
          ? await drawNextWinner(signerProvider, network.contractAddress, networkKey, transaction.submit)
          : await drawBatchWinners(signerProvider, network.contractAddress, networkKey, safePrizeSlotIndexes.length, transaction.submit)
      transaction.confirm(hash)
      const nextStatus = await readStatusForWalletUntil(
        wallet,
        networkKey,
        (status) => status.revealedPrizeSlots.length > previousRevealCount || status.fulfilled,
      )
      const revealedResults = revealResultsFromStatus(nextStatus, previousRevealCount)
      setDrawMessage(`${copy.walletPanel.drawNextSent}: ${hash}`)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: safePrizeSlotIndexes.length,
        prize_slot_indexes: safePrizeSlotIndexes.join(','),
        revealed_count: revealedResults.length,
        status: 'success',
      })
      return revealedResults
    } catch (error) {
      transaction.fail(error)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: safePrizeSlotIndexes.length,
        prize_slot_indexes: safePrizeSlotIndexes.join(','),
        revealed_count: 0,
        status: 'error',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.drawNextFailed)
      return []
    } finally {
      setDrawBusy(null)
    }
  }

  function handleHiddenDrawUnlockHit() {
    drawUnlockHitsRef.current += 1
    if (drawUnlockHitsRef.current < SECRET_DRAW_UNLOCK_CLICKS) return

    drawUnlockHitsRef.current = 0
    writeStoredDrawUnlocked(true)
    setDrawUnlocked(true)
    handlePageChange('draw')
    trackEvent('hidden_draw_unlock', {
      status: 'success',
    })
  }

  if (loadError) {
    return (
      <main className="app-shell centered">
        <section className="panel fatal">
          <AlertTriangle size={28} />
          <h1>Could not load raffle data</h1>
          <p>{loadError}</p>
        </section>
      </main>
    )
  }

  if (!ledger || !displayLedger) {
    return <InitialPageLoader isLeaving={false} />
  }

  return (
    <>
      <main className={`app-shell raffle-shell page-${activePage}`} aria-busy={initialLoaderMounted}>
        <header className="nav">
          <div className="nav-main-row">
            <a
              className="brand"
              href="#tickets"
              onClick={(event) => {
                event.preventDefault()
                handlePageChange('tickets')
              }}
            >
              <img className="brand-logo" src={renaissLogo} alt="Renaiss" />
              <span className="brand-text">{copy.common.brand}</span>
            </a>
            <nav className="nav-links nav-inline-links" aria-label="Lucky draw pages">
              {visibleNavItems.map((key) => (
                <Fragment key={key}>
                  <a
                    className={activePage === key ? 'active' : ''}
                    href={`#${key}`}
                    onClick={(event) => {
                      event.preventDefault()
                      handlePageChange(key)
                    }}
                  >
                    {copy.nav[key]}
                  </a>
                  {key === 'simulator' && (
                    <span className="nav-coming-soon" aria-disabled="true">
                      {copy.nav.comingSoon}
                    </span>
                  )}
                </Fragment>
              ))}
            </nav>
            <div className="nav-visible-actions">
              {activePage === 'draw' && wallet && (
                <button className="nav-wallet-disconnect" type="button" onClick={disconnectWallet}>
                  <LogOut size={14} />
                  <span>{copy.walletPanel.disconnectWallet}</span>
                </button>
              )}
              <label className="language-switcher">
                <span>{copy.common.language}</span>
                <select
                  value={language}
                  onChange={(event) => handleLanguageChange(event.target.value as LanguageCode)}
                  aria-label={copy.common.language}
                >
                  {LANGUAGES.map((item) => (
                    <option value={item.code} key={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </header>

      {walletError && (
        <section className="notice">
          <AlertTriangle size={20} />
          <div>
            <strong>{copy.walletPanel.connectionFailed}</strong>
            <span>{walletError}</span>
          </div>
        </section>
      )}

      <WalletSelectorModal
        copy={copy}
        isConnecting={drawBusy === 'connect'}
        isOpen={walletSelectorOpen}
        providers={walletProviderOptions}
        onClose={() => setWalletSelectorOpen(false)}
        onRefresh={refreshWalletProviders}
        onSelect={(providerOption) => {
          void connectBscWallet(walletSelectorNetworkKey, providerOption)
        }}
      />

      <Suspense fallback={<PageChunkLoader />}>
        {activePage === 'tickets' && (
          <TicketHome
            entry={selectedEntry}
            ledger={ledger}
            query={query}
            setQuery={setQuery}
            connectedAddress={wallet?.address}
            walletIdentities={walletIdentities}
            winnerTicketsBySlot={activeWinnerTicketsBySlot}
            reserveTicketsBySlot={activeReserveTicketsBySlot}
            revealedPrizeSlots={activeRevealedPrizeSlots}
            copy={copy}
            language={language}
            lastLedgerRefreshAt={lastLedgerRefreshAt}
            nextLedgerRefreshAt={nextLedgerRefreshAt}
            onHiddenDrawUnlock={handleHiddenDrawUnlockHit}
            onCopyTicketRanges={(details) => trackEvent('copy_ticket_ranges', details)}
            onLoadIdentitySuggestions={loadIdentitySuggestions}
            onResolveEntry={resolveTicketEntry}
            onLoadEntryIntervals={loadTicketEntryIntervals}
            onTicketSearch={(details) => trackEvent('ticket_search', details)}
            onTicketSearchResult={(details) => trackEvent('ticket_search_result', details)}
          />
        )}

        {activePage === 'rules' && <PrizeRules copy={copy} ledger={ledger} />}

        {activePage === 'simulator' && (
          <>
            <PageHeader
              eyebrow={copy.simulation.eyebrow}
              title={copy.simulation.title}
              copy={copy.simulation.copy}
            />
            {fullLedgerError ? (
              <section className="notice">
                <AlertTriangle size={20} />
                <div>
                  <strong>Could not load full raffle ledger</strong>
                  <span>{fullLedgerError}</span>
                </div>
              </section>
            ) : currentFullLedger ? (
              <SimpleDrawSimulator ledger={currentFullLedger} walletIdentities={walletIdentities} copy={copy} />
            ) : (
              <main className="app-shell centered">
                <Loader2 className="spin" size={34} />
                <p>Loading full raffle ledger...</p>
              </main>
            )}
          </>
        )}

        {activePage === 'draw' && fullLedgerError && (
          <section className="notice">
            <AlertTriangle size={20} />
            <div>
              <strong>Could not load full raffle ledger</strong>
              <span>{fullLedgerError}</span>
            </div>
          </section>
        )}

        {activePage === 'draw' && !fullLedgerError && !currentFullLedger && (
          <main className="app-shell centered">
            <Loader2 className="spin" size={34} />
            <p>Loading full raffle ledger...</p>
          </main>
        )}

        {activePage === 'draw' && currentFullLedger && (
          <>
            <PageHeader
              eyebrow={copy.draw.eyebrow}
              title={copy.draw.title}
              copy={copy.draw.copy}
            />
            <section className="page-grid contract-page">
              <DrawReveal
                runMode={drawRunMode}
                onRunModeChange={handleDrawRunModeChange}
                winnerTicketsBySlot={activeWinnerTicketsBySlot}
                reserveTicketsBySlot={activeReserveTicketsBySlot}
                revealedPrizeSlots={activeRevealedPrizeSlots}
                totalTickets={currentFullLedger.totalFinalTickets}
                ledger={currentFullLedger}
                walletIdentities={walletIdentities}
                copy={copy}
                drawStatus={activeDrawStatus}
                isMainnetOnlyMode={mainnetOnlyDrawMode}
                hasWallet={Boolean(wallet)}
                isContractBusy={drawBusy === 'reset' || drawBusy === 'finalize' || drawBusy === 'draw' || drawBusy === 'drawNext'}
                isContractLedgerMismatch={isActiveContractLedgerMismatch}
                canResetRound={Boolean(activeDrawStatus && activeDrawStatus.state !== 2 && (activeDrawStatus.finalized || activeDrawStatus.winnerCount > 0n))}
                operatorMessage={drawMessage}
                onConnectWallet={() => openWalletSelector(activeDrawNetworkKey)}
                onResetRound={() => resetContractRound(activeDrawNetworkKey)}
                onFinalizeLedger={() => lockLedgerRound(activeDrawNetworkKey)}
                onRefreshStatus={() => refreshDrawStatus(activeDrawNetworkKey)}
                onRequestDraw={() => requestDrawRound(activeDrawNetworkKey)}
                onDrawContractPrizeSlots={(prizeSlotIndexes) => drawContractPrizeSlots(prizeSlotIndexes, activeDrawNetworkKey)}
              />
              <DrawTransactionTimeline
                network={activeDrawNetwork}
                records={activeDrawTxRecords}
                chainTransactions={activeDrawEventHistory?.history?.transactions ?? []}
                chainStatus={activeDrawEventHistoryKey ? activeDrawEventHistory?.status ?? 'loading' : 'idle'}
                chainError={activeDrawEventHistory?.error ?? ''}
                copy={copy}
              />
              <section className="panel ledger-download-panel">
                <div>
                  <span className="eyebrow">{copy.draw.ledgerDownloadEyebrow}</span>
                  <h2>{copy.draw.ledgerDownloadTitle}</h2>
                  <p>{copy.draw.ledgerDownloadCopy}</p>
                </div>
                <a className="icon-button ledger-download-button" href={DRAW_LEDGER_URI} download="renaiss-lucky-draw-ledger.json">
                  <Download size={18} />
                  <span>{copy.draw.downloadLedger}</span>
                </a>
              </section>
              <WalletPanel
                network={activeDrawNetwork}
                wallet={wallet}
                status={activeDrawStatus}
                message={drawMessage}
                ledgerTotalTickets={currentFullLedger.totalFinalTickets}
                ledgerHash={currentFullLedger.ledgerHash}
                prizeSlotCount={TOTAL_PRIZE_DRAW_SLOTS}
                vrfTiming={activeDrawVrfTiming}
                authorizedOperatorAddress={activeDrawStatus?.drawOperatorAddress ?? activeDrawNetwork.authorizedOperatorAddress}
                isAuthorizedOperator={isActiveAuthorizedOperator}
                isContractOwner={isActiveContractOwner}
                copy={copy}
              />
              <ContractDetails ledger={currentFullLedger} network={activeDrawNetwork} copy={copy} />
              <section className="draw-support-panel">
                <article className="draw-support-card draw-support-card--media">
                  <img src={liveDrawImage} alt="Van Gogh live draw machine artwork" decoding="async" loading="lazy" />
                  <div>
                    <span>{copy.draw.liveReady}</span>
                    <strong>{copy.draw.liveTitle}</strong>
                    <p>{copy.draw.liveCopy}</p>
                  </div>
                </article>
                <article className="draw-support-card">
                  <ShieldCheck size={22} />
                  <span>{copy.draw.securityEyebrow}</span>
                  <strong>{copy.draw.securityTitle}</strong>
                  <p>{copy.draw.securityCopy1}</p>
                </article>
                <article className="draw-support-card">
                  <Trophy size={22} />
                  <span>{copy.contract.stepLabel} 3</span>
                  <strong>{copy.contract.winnersMatched}</strong>
                  <p>{copy.draw.securityCopy2}</p>
                </article>
              </section>
              {isActiveContractOwner && wallet && activeDrawStatus && (
                <DrawAdminPanel
                  network={activeDrawNetwork}
                  networkKey={activeDrawNetworkKey}
                  wallet={wallet}
                  status={activeDrawStatus}
                  copy={copy}
                  onRefreshStatus={() => refreshDrawStatus(activeDrawNetworkKey)}
                />
              )}
            </section>
          </>
        )}
        </Suspense>
      </main>
      {initialLoaderMounted && <InitialPageLoader isLeaving={!initialLoaderVisible} />}
    </>
  )
}
