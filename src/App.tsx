import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, ShieldCheck, Trophy } from 'lucide-react'
import './App.css'
import './styles/raffle-foundation.css'
import './styles/raffle-tickets.css'
import './styles/raffle-rules.css'
import './styles/raffle-draw.css'
import './styles/raffle-simulator.css'
import './styles/raffle-polish.css'
import renaissLogo from './assets/renaiss-logo-alpha-cropped.webp'
import holoCardBackImage from './assets/psa-pikachu-van-gogh-back-cut-fast.webp'
import holoCardFrontImage from './assets/psa-pikachu-van-gogh-front-cut-fast.webp'
import liveDrawImage from './assets/van-gogh-live-source.webp'
import heroBackgroundImage from './assets/van-gogh-starry-hero-bg.webp'
import { InitialPageLoader } from './components/InitialPageLoader'
import { TicketHome } from './components/TicketHome'
import { initializeAnalytics, trackEvent, trackPageView } from './lib/analytics'
import { COPY, LANGUAGES, type LanguageCode } from './lib/i18n'
import { loadFullRaffleLedger, loadRaffleEntry, loadRaffleLedger } from './lib/ticketing/openMonitor'
import { loadWalletIdentities, type WalletIdentityMap } from './lib/ticketing/identities'
import type { RaffleEntry, RaffleLedger } from './lib/ticketing/types'
import {
  DRAW_NETWORKS,
  isAuthorizedDrawOperator,
  isDrawNetworkKey,
  sameAddress,
  type DrawNetworkKey,
  type DrawRunMode,
} from './lib/contracts/luckyDrawNetworks'
import {
  connectInjectedWallet,
  drawBatchWinners,
  drawNextWinner,
  finalizeContractLedger,
  readDrawStatus,
  requestContractDraw,
  resetContractDraft,
  type ConnectedWallet,
  type DrawStatus,
} from './lib/wallet/bsc'
import { TOTAL_PRIZE_DRAW_SLOTS } from './lib/draw/prizeSlots'

type PageKey = 'tickets' | 'rules' | 'simulator' | 'draw'

const ContractDetails = lazy(() => import('./components/ContractDetails').then((module) => ({ default: module.ContractDetails })))
const DrawReveal = lazy(() => import('./components/DrawReveal').then((module) => ({ default: module.DrawReveal })))
const PrizeRules = lazy(() => import('./components/PrizeRules').then((module) => ({ default: module.PrizeRules })))
const SimpleDrawSimulator = lazy(() => import('./components/SimpleDrawSimulator').then((module) => ({ default: module.SimpleDrawSimulator })))
const WalletPanel = lazy(() => import('./components/WalletPanel').then((module) => ({ default: module.WalletPanel })))

const LEDGER_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const FULL_LEDGER_PRELOAD_DELAY_MS = 1200
const INITIAL_LOADER_MIN_VISIBLE_MS = 1100
const INITIAL_LOADER_EXIT_MS = 540
const SECRET_DRAW_UNLOCK_CLICKS = 3
const DRAW_LEDGER_URI = '/lucky-draw-ledger.json'
const VRF_STATUS_FAST_POLL_MS = 1800
const VRF_STATUS_SLOW_POLL_MS = 4500
const VRF_STATUS_FAST_POLL_COUNT = 18
const INITIAL_PRELOAD_ASSETS = [renaissLogo, heroBackgroundImage, holoCardFrontImage, holoCardBackImage]

const PUBLIC_NAV_ITEMS: PageKey[] = ['tickets', 'rules', 'simulator']
type DrawBusyState = 'connect' | 'read' | 'finalize' | 'draw' | 'drawNext' | 'reset' | null

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

export default function App() {
  const [ledger, setLedger] = useState<RaffleLedger | null>(null)
  const [fullLedger, setFullLedger] = useState<RaffleLedger | null>(null)
  const [loadError, setLoadError] = useState('')
  const [fullLedgerError, setFullLedgerError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<RaffleEntry | null>(null)
  const [page, setPage] = useState<PageKey>('tickets')
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null)
  const [walletError, setWalletError] = useState('')
  const [drawRunMode, setDrawRunMode] = useState<DrawRunMode>('showcase')
  const [winnerTicketsByNetwork, setWinnerTicketsByNetwork] = useState<Partial<Record<DrawNetworkKey, bigint[]>>>({})
  const [drawStatusByNetwork, setDrawStatusByNetwork] = useState<Partial<Record<DrawNetworkKey, DrawStatus>>>({})
  const [drawTxHashesByNetwork, setDrawTxHashesByNetwork] = useState<Partial<Record<DrawNetworkKey, string[]>>>({})
  const [drawMessage, setDrawMessage] = useState('')
  const [drawBusy, setDrawBusy] = useState<DrawBusyState>(null)
  const [walletIdentities, setWalletIdentities] = useState<WalletIdentityMap>({})
  const [language, setLanguage] = useState<LanguageCode>('zh-TW')
  const [lastLedgerRefreshAt, setLastLedgerRefreshAt] = useState<number>(0)
  const [nextLedgerRefreshAt, setNextLedgerRefreshAt] = useState<number>(0)
  const [drawUnlocked, setDrawUnlocked] = useState(false)
  const [initialAssetsReady, setInitialAssetsReady] = useState(false)
  const [initialCoverPaintReady, setInitialCoverPaintReady] = useState(false)
  const [initialLoaderVisible, setInitialLoaderVisible] = useState(true)
  const [initialLoaderMounted, setInitialLoaderMounted] = useState(true)
  const [initialLoaderStartedAt] = useState(() => Date.now())
  const drawUnlockHitsRef = useRef(0)
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
  const activeWinnerTickets = wallet ? (activeStoredDrawStatus?.winnerTickets ?? winnerTicketsByNetwork[activeDrawNetworkKey] ?? []) : []
  const activeDrawStatus = wallet ? activeStoredDrawStatus : null
  const activeDrawTxHashes = drawTxHashesByNetwork[activeDrawNetworkKey] ?? []
  const isActiveContractOwner = sameAddress(wallet?.address, activeDrawStatus?.ownerAddress)
  const isActiveAuthorizedOperator = activeDrawStatus
    ? Boolean(
        sameAddress(wallet?.address, activeDrawStatus.ownerAddress) ||
          sameAddress(wallet?.address, activeDrawStatus.drawOperatorAddress),
      )
    : isAuthorizedDrawOperator(wallet?.address, activeDrawNetwork)
  const activeLedgerForContractCheck = currentFullLedger ?? ledger
  const isActiveContractLedgerMismatch = Boolean(
    activeDrawStatus &&
      activeLedgerForContractCheck &&
      (activeDrawStatus.totalTickets !== BigInt(activeLedgerForContractCheck.totalFinalTickets) ||
        activeDrawStatus.prizeSlotCount !== BigInt(TOTAL_PRIZE_DRAW_SLOTS) ||
        (activeLedgerForContractCheck.ledgerHash && activeDrawStatus.ledgerHash.toLowerCase() !== activeLedgerForContractCheck.ledgerHash.toLowerCase())),
  )
  const initialCoverAssetsReady = Boolean(ledger && displayLedger && initialAssetsReady)
  const initialExperienceReady = initialCoverAssetsReady && initialCoverPaintReady
  const visibleNavItems = useMemo<PageKey[]>(
    () => (drawUnlocked ? [...PUBLIC_NAV_ITEMS, 'draw'] : PUBLIC_NAV_ITEMS),
    [drawUnlocked],
  )

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
        const value = await loadFullRaffleLedger({ force: Boolean(fullLedger && !fullLedgerIsCurrent) })
        if (alive) setFullLedger(value)
      } catch (error) {
        if (alive) setFullLedgerError(error instanceof Error ? error.message : 'Could not load full raffle ledger.')
      }
    }

    void refreshFullLedger()

    return () => {
      alive = false
    }
  }, [fullLedger, fullLedgerIsCurrent, needsFullLedger])

  useEffect(() => {
    if (!ledger || fullLedgerIsCurrent) return undefined

    const preloadKey = summaryLedgerKey || 'current'
    if (fullLedgerPreloadKeyRef.current === preloadKey) return undefined
    fullLedgerPreloadKeyRef.current = preloadKey

    let alive = true
    const timeoutId = window.setTimeout(() => {
      setFullLedgerError('')
      void loadFullRaffleLedger({ force: Boolean(fullLedger && !fullLedgerIsCurrent) })
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
  }, [fullLedger, fullLedgerIsCurrent, ledger, summaryLedgerKey])

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
    setDrawRunMode(nextMode)
    setDrawMessage('')
    trackEvent('draw_run_mode_change', {
      mode: nextMode,
    })
  }

  async function readStatusForWallet(activeWallet: ConnectedWallet, networkKey: DrawNetworkKey): Promise<DrawStatus> {
    const network = DRAW_NETWORKS[networkKey]
    const nextStatus = await readDrawStatus(activeWallet.provider, network.contractAddress, networkKey)
    setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: nextStatus }))
    setWinnerTicketsByNetwork((current) => ({ ...current, [networkKey]: nextStatus.winnerTickets }))
    return nextStatus
  }

  useEffect(() => {
    if (activePage !== 'draw') return undefined
    if (!wallet || !isActiveAuthorizedOperator) return undefined
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
        const nextStatus = await readDrawStatus(activeWallet.provider, network.contractAddress, networkKey)
        if (cancelled) return
        setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: nextStatus }))
        setWinnerTicketsByNetwork((current) => ({ ...current, [networkKey]: nextStatus.winnerTickets }))
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
    isActiveAuthorizedOperator,
    wallet,
  ])

  async function connectBscWallet(networkKey = activeDrawNetworkKey) {
    setWalletError('')
    setDrawMessage('')
    setDrawBusy('connect')
    trackEvent('wallet_connect', {
      network: networkKey,
    })
    let walletConnected = false
    try {
      const nextWallet = await connectInjectedWallet(networkKey)
      walletConnected = true
      setWallet(nextWallet)
      setDrawUnlocked(true)
      setPage('draw')
      trackEvent('wallet_connect_result', {
        network: networkKey,
        status: 'success',
      })
      try {
        await readStatusForWallet(nextWallet, networkKey)
        trackEvent('draw_status_read', {
          network: networkKey,
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
          status: 'error',
        })
      }
      setWalletError(error instanceof Error ? error.message : copy.walletPanel.connectionFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function refreshDrawStatus(networkKey = activeDrawNetworkKey) {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      trackEvent('draw_status_read', {
        network: networkKey,
        status: 'blocked_no_wallet',
      })
      return
    }
    setDrawBusy('read')
    setDrawMessage('')
    try {
      await readStatusForWallet(wallet, networkKey)
      trackEvent('draw_status_read', {
        network: networkKey,
        status: 'success',
        trigger: 'manual_refresh',
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
    const currentStatus = drawStatusByNetwork[networkKey]
    if (currentStatus && !sameAddress(wallet.address, currentStatus.ownerAddress)) {
      setDrawMessage(copy.walletPanel.ownerOnlyAction)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'blocked_not_contract_owner',
      })
      return
    }
    const ledgerForDraw = currentFullLedger ?? ledger
    if (!ledgerForDraw?.ledgerHash) {
      setDrawMessage(copy.walletPanel.ledgerHashMissing)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'blocked_missing_ledger_hash',
      })
      return
    }
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
    try {
      const hash = await finalizeContractLedger(
        wallet.provider,
        network.contractAddress,
        networkKey,
        ledgerForDraw.ledgerHash,
        ledgerForDraw.totalFinalTickets,
        TOTAL_PRIZE_DRAW_SLOTS,
        DRAW_LEDGER_URI,
      )
      setDrawTxHashesByNetwork((current) => ({ ...current, [networkKey]: [hash, ...(current[networkKey] ?? [])] }))
      setDrawMessage(`${copy.walletPanel.finalizeSent}: ${hash}`)
      await readStatusForWallet(wallet, networkKey)
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'success',
      })
    } catch (error) {
      trackEvent('draw_finalize', {
        network: networkKey,
        status: 'error',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.finalizeFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function resetContractRound(networkKey = activeDrawNetworkKey) {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'blocked_no_wallet',
      })
      return
    }

    const network = DRAW_NETWORKS[networkKey]
    setDrawBusy('reset')
    setDrawMessage('')
    trackEvent('draw_reset', {
      network: networkKey,
      status: 'start',
    })

    try {
      const currentStatus = drawStatusByNetwork[networkKey] ?? (await readStatusForWallet(wallet, networkKey))
      if (!sameAddress(wallet.address, currentStatus.ownerAddress)) {
        setDrawMessage(copy.walletPanel.ownerOnlyAction)
        trackEvent('draw_reset', {
          network: networkKey,
          status: 'blocked_not_contract_owner',
        })
        return
      }

      if (currentStatus.state === 2) {
        setDrawMessage(copy.walletPanel.resetBlockedDuringRequest)
        trackEvent('draw_reset', {
          network: networkKey,
          status: 'blocked_randomness_requested',
        })
        return
      }

      const hash = await resetContractDraft(wallet.provider, network.contractAddress, networkKey)
      setDrawTxHashesByNetwork((current) => ({ ...current, [networkKey]: [hash, ...(current[networkKey] ?? [])] }))
      setDrawMessage(`${copy.walletPanel.resetSent}: ${hash}`)
      await readStatusForWallet(wallet, networkKey)
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'success',
      })
    } catch (error) {
      trackEvent('draw_reset', {
        network: networkKey,
        status: 'error',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.resetFailed)
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
    if (!isAuthorizedDrawOperator(wallet.address, network)) {
      setDrawMessage(copy.walletPanel.unauthorizedOperator)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'blocked_unauthorized_operator',
      })
      return
    }
    const currentStatus = drawStatusByNetwork[networkKey]
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
    setDrawBusy('draw')
    setDrawMessage('')
    trackEvent('draw_request', {
      network: networkKey,
      status: 'start',
    })
    try {
      const hash = await requestContractDraw(wallet.provider, network.contractAddress, networkKey)
      setDrawTxHashesByNetwork((current) => ({ ...current, [networkKey]: [hash, ...(current[networkKey] ?? [])] }))
      setDrawMessage(`${copy.walletPanel.drawSent}: ${hash}`)
      await readStatusForWallet(wallet, networkKey)
      trackEvent('draw_request', {
        network: networkKey,
        status: 'success',
      })
    } catch (error) {
      trackEvent('draw_request', {
        network: networkKey,
        status: 'error',
      })
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.drawFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function drawContractWinners(count: number, networkKey = activeDrawNetworkKey): Promise<bigint[]> {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: count,
        status: 'blocked_no_wallet',
      })
      return []
    }

    const network = DRAW_NETWORKS[networkKey]
    if (!isAuthorizedDrawOperator(wallet.address, network)) {
      setDrawMessage(copy.walletPanel.unauthorizedOperator)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: count,
        status: 'blocked_unauthorized_operator',
      })
      return []
    }
    const currentStatus = drawStatusByNetwork[networkKey]
    if (!currentStatus?.requested) {
      setDrawMessage(copy.walletPanel.requestVrfFirst)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: count,
        status: 'blocked_vrf_not_requested',
      })
      return []
    }
    if (currentStatus.state < 3) {
      setDrawMessage(copy.drawReveal.waitingForVrf)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: count,
        status: 'blocked_vrf_not_ready',
      })
      return []
    }
    const networkWinnerTickets = winnerTicketsByNetwork[networkKey] ?? []
    const safeCount = Math.max(1, Math.floor(count))
    setDrawBusy('drawNext')
    setDrawMessage('')
    trackEvent('draw_next', {
      network: networkKey,
      requested_count: safeCount,
      status: 'start',
    })
    try {
      const previousCount = networkWinnerTickets.length
      const hash =
        safeCount === 1
          ? await drawNextWinner(wallet.provider, network.contractAddress, networkKey)
          : await drawBatchWinners(wallet.provider, network.contractAddress, networkKey, safeCount)
      setDrawTxHashesByNetwork((current) => ({ ...current, [networkKey]: [hash, ...(current[networkKey] ?? [])] }))
      const nextStatus = await readStatusForWallet(wallet, networkKey)
      const revealedTickets = nextStatus.winnerTickets.slice(previousCount, previousCount + safeCount)
      setDrawMessage(`${copy.walletPanel.drawNextSent}: ${hash}`)
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: safeCount,
        revealed_count: revealedTickets.length,
        status: 'success',
      })
      return revealedTickets
    } catch (error) {
      trackEvent('draw_next', {
        network: networkKey,
        requested_count: safeCount,
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
    setDrawUnlocked(true)
    setPage('draw')
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
                <a
                  className={activePage === key ? 'active' : ''}
                  href={`#${key}`}
                  key={key}
                  onClick={(event) => {
                    event.preventDefault()
                    handlePageChange(key)
                  }}
                >
                  {copy.nav[key]}
                </a>
              ))}
            </nav>
            <div className="nav-visible-actions">
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

      <Suspense fallback={<PageChunkLoader />}>
        {activePage === 'tickets' && (
          <TicketHome
            entry={selectedEntry}
            ledger={ledger}
            query={query}
            setQuery={setQuery}
            connectedAddress={wallet?.address}
            walletIdentities={walletIdentities}
            copy={copy}
            language={language}
            lastLedgerRefreshAt={lastLedgerRefreshAt}
            nextLedgerRefreshAt={nextLedgerRefreshAt}
            onHiddenDrawUnlock={handleHiddenDrawUnlockHit}
            onCopyTicketRanges={(details) => trackEvent('copy_ticket_ranges', details)}
            onResolveEntry={resolveTicketEntry}
            onLoadEntryIntervals={loadTicketEntryIntervals}
            onTicketSearch={(details) => trackEvent('ticket_search', details)}
            onTicketSearchResult={(details) => trackEvent('ticket_search_result', details)}
          />
        )}

        {activePage === 'rules' && <PrizeRules copy={copy} />}

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
                winnerTickets={activeWinnerTickets}
                totalTickets={currentFullLedger.totalFinalTickets}
                ledger={currentFullLedger}
                walletIdentities={walletIdentities}
                copy={copy}
                drawStatus={activeDrawStatus}
                hasWallet={Boolean(wallet && isActiveAuthorizedOperator)}
                isContractBusy={drawBusy === 'finalize' || drawBusy === 'draw' || drawBusy === 'drawNext' || drawBusy === 'reset'}
                isContractLedgerMismatch={isActiveContractLedgerMismatch}
                onConnectWallet={() => connectBscWallet(activeDrawNetworkKey)}
                onRequestDraw={() => requestDrawRound(activeDrawNetworkKey)}
                onDrawContractWinners={(count) => drawContractWinners(count, activeDrawNetworkKey)}
              />
              <WalletPanel
                network={activeDrawNetwork}
                wallet={wallet}
                status={activeDrawStatus}
                message={drawMessage}
                busy={drawBusy}
                ledgerTotalTickets={currentFullLedger.totalFinalTickets}
                ledgerHash={currentFullLedger.ledgerHash}
                prizeSlotCount={TOTAL_PRIZE_DRAW_SLOTS}
                transactionHashes={activeDrawTxHashes}
                authorizedOperatorAddress={activeDrawStatus?.drawOperatorAddress ?? activeDrawNetwork.authorizedOperatorAddress}
                isAuthorizedOperator={isActiveAuthorizedOperator}
                isContractOwner={isActiveContractOwner}
                onConnectWallet={() => connectBscWallet(activeDrawNetworkKey)}
                onRefreshStatus={() => refreshDrawStatus(activeDrawNetworkKey)}
                onFinalizeLedger={() => lockLedgerRound(activeDrawNetworkKey)}
                onResetRound={() => resetContractRound(activeDrawNetworkKey)}
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
            </section>
          </>
        )}
        </Suspense>
      </main>
      {initialLoaderMounted && <InitialPageLoader isLeaving={!initialLoaderVisible} />}
    </>
  )
}
