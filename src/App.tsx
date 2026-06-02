import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileCode2, Loader2, ShieldCheck, Ticket, Trophy } from 'lucide-react'
import './App.css'
import './styles/raffle-foundation.css'
import './styles/raffle-tickets.css'
import './styles/raffle-rules.css'
import './styles/raffle-draw.css'
import './styles/raffle-polish.css'
import renaissLogo from './assets/renaiss-logo-alpha-cropped.png'
import liveDrawImage from './assets/van-gogh-live-source.jpeg'
import { ContractDetails } from './components/ContractDetails'
import { DrawReveal } from './components/DrawReveal'
import { PrizeRules } from './components/PrizeRules'
import { TicketHome } from './components/TicketHome'
import { WalletPanel } from './components/WalletPanel'
import { COPY, LANGUAGES, type LanguageCode } from './lib/i18n'
import { loadRaffleLedger } from './lib/ticketing/openMonitor'
import { entryMatches } from './lib/ticketing/display'
import { loadWalletIdentities, type WalletIdentityMap } from './lib/ticketing/identities'
import type { RaffleLedger } from './lib/ticketing/types'
import { DRAW_NETWORKS, isDrawNetworkKey, type DrawNetworkKey, type DrawRunMode } from './lib/contracts/luckyDrawNetworks'
import {
  connectInjectedWallet,
  drawNextWinner,
  readPublicDrawStatus,
  readDrawStatus,
  requestContractDraw,
  type ConnectedWallet,
  type DrawStatus,
} from './lib/wallet/bsc'

type PageKey = 'tickets' | 'rules' | 'draw'

const LEDGER_REFRESH_INTERVAL_MS = 15 * 60 * 1000

const NAV_ITEMS: PageKey[] = ['tickets', 'rules', 'draw']
type DrawBusyState = 'connect' | 'read' | 'draw' | 'drawNext' | null

function PageHeader({
  eyebrow,
  title,
  copy,
  icon: Icon,
}: {
  eyebrow: string
  title: string
  copy: string
  icon: typeof Ticket
}) {
  return (
    <section className="page-hero">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      <div className="page-hero-icon">
        <Icon size={30} />
      </div>
    </section>
  )
}

export default function App() {
  const [ledger, setLedger] = useState<RaffleLedger | null>(null)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<PageKey>('tickets')
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null)
  const [walletError, setWalletError] = useState('')
  const [drawRunMode, setDrawRunMode] = useState<DrawRunMode>('showcase')
  const [winnerTicketsByNetwork, setWinnerTicketsByNetwork] = useState<Partial<Record<DrawNetworkKey, bigint[]>>>({})
  const [drawStatusByNetwork, setDrawStatusByNetwork] = useState<Partial<Record<DrawNetworkKey, DrawStatus>>>({})
  const [drawMessage, setDrawMessage] = useState('')
  const [drawBusy, setDrawBusy] = useState<DrawBusyState>(null)
  const [walletIdentities, setWalletIdentities] = useState<WalletIdentityMap>({})
  const [language, setLanguage] = useState<LanguageCode>('zh-TW')
  const [lastLedgerRefreshAt, setLastLedgerRefreshAt] = useState<number>(0)
  const [nextLedgerRefreshAt, setNextLedgerRefreshAt] = useState<number>(0)
  const copy = COPY[language]
  const activeDrawNetworkKey: DrawNetworkKey = isDrawNetworkKey(drawRunMode) ? drawRunMode : 'mainnet'
  const activeDrawNetwork = DRAW_NETWORKS[activeDrawNetworkKey]
  const activeWinnerTickets = drawStatusByNetwork[activeDrawNetworkKey]?.winnerTickets ?? winnerTicketsByNetwork[activeDrawNetworkKey] ?? []
  const activeDrawStatus = drawStatusByNetwork[activeDrawNetworkKey] ?? null

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

  useEffect(() => {
    if (!isDrawNetworkKey(drawRunMode) || wallet) return undefined
    let alive = true
    const networkKey = drawRunMode
    const network = DRAW_NETWORKS[networkKey]

    async function refreshPublicDrawStatus() {
      setDrawMessage('')
      try {
        const nextStatus = await readPublicDrawStatus(network.contractAddress, networkKey)
        if (!alive) return
        setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: nextStatus }))
        setWinnerTicketsByNetwork((current) => ({ ...current, [networkKey]: nextStatus.winnerTickets }))
      } catch (error) {
        if (!alive) return
        setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.readFailed)
      }
    }

    void refreshPublicDrawStatus()

    return () => {
      alive = false
    }
  }, [copy.walletPanel.readFailed, drawRunMode, wallet])

  const selectedEntry = useMemo(() => {
    if (!ledger || !query.trim()) return null
    return ledger.entries.find((entry) => entryMatches(entry, query)) ?? null
  }, [ledger, query])
  async function readStatusForWallet(activeWallet: ConnectedWallet, networkKey: DrawNetworkKey): Promise<DrawStatus> {
    const network = DRAW_NETWORKS[networkKey]
    const nextStatus = await readDrawStatus(activeWallet.provider, network.contractAddress, networkKey)
    setDrawStatusByNetwork((current) => ({ ...current, [networkKey]: nextStatus }))
    setWinnerTicketsByNetwork((current) => ({ ...current, [networkKey]: nextStatus.winnerTickets }))
    return nextStatus
  }

  async function connectBscWallet(networkKey = activeDrawNetworkKey) {
    setWalletError('')
    setDrawMessage('')
    setDrawBusy('connect')
    try {
      const nextWallet = await connectInjectedWallet(networkKey)
      setWallet(nextWallet)
      setPage('draw')
      await readStatusForWallet(nextWallet, networkKey)
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : copy.walletPanel.connectionFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function refreshDrawStatus(networkKey = activeDrawNetworkKey) {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      return
    }
    setDrawBusy('read')
    setDrawMessage('')
    try {
      await readStatusForWallet(wallet, networkKey)
    } catch (error) {
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.readFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function requestDrawRound(networkKey = activeDrawNetworkKey) {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      return
    }
    const network = DRAW_NETWORKS[networkKey]
    setDrawBusy('draw')
    setDrawMessage('')
    try {
      const hash = await requestContractDraw(wallet.provider, network.contractAddress, networkKey)
      setDrawMessage(`${copy.walletPanel.drawSent}: ${hash}`)
      await readStatusForWallet(wallet, networkKey)
    } catch (error) {
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.drawFailed)
    } finally {
      setDrawBusy(null)
    }
  }

  async function drawContractWinners(count: number, networkKey = activeDrawNetworkKey): Promise<bigint[]> {
    if (!wallet) {
      setDrawMessage(copy.walletPanel.connectFirst)
      return []
    }

    const network = DRAW_NETWORKS[networkKey]
    const networkWinnerTickets = winnerTicketsByNetwork[networkKey] ?? []
    const revealedTickets: bigint[] = []
    setDrawBusy('drawNext')
    setDrawMessage('')
    try {
      for (let index = 0; index < count; index += 1) {
        const previousCount = networkWinnerTickets.length + revealedTickets.length
        const hash = await drawNextWinner(wallet.provider, network.contractAddress, networkKey)
        const nextStatus = await readStatusForWallet(wallet, networkKey)
        const nextTicket = nextStatus.winnerTickets[previousCount]
        if (nextTicket) revealedTickets.push(nextTicket)
        setDrawMessage(`${copy.walletPanel.drawNextSent}: ${hash}`)
      }
      return revealedTickets
    } catch (error) {
      setDrawMessage(error instanceof Error ? error.message : copy.walletPanel.drawNextFailed)
      return revealedTickets
    } finally {
      setDrawBusy(null)
    }
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

  if (!ledger) {
    return (
      <main className="app-shell centered">
        <Loader2 className="spin" size={34} />
        <p>Loading raffle ledger...</p>
      </main>
    )
  }

  return (
    <main className={`app-shell raffle-shell page-${page}`}>
      <header className="nav">
        <div className="nav-main-row">
          <a
            className="brand"
            href="#tickets"
            onClick={(event) => {
              event.preventDefault()
              setPage('tickets')
            }}
          >
            <img className="brand-logo" src={renaissLogo} alt="Renaiss" />
            <span className="brand-text">{copy.common.brand}</span>
          </a>
          <nav className="nav-links nav-inline-links" aria-label="Lucky draw pages">
            {NAV_ITEMS.map((key) => (
              <a
                className={page === key ? 'active' : ''}
                href={`#${key}`}
                key={key}
                onClick={(event) => {
                  event.preventDefault()
                  setPage(key)
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
                onChange={(event) => setLanguage(event.target.value as LanguageCode)}
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

      {page === 'tickets' && (
        <TicketHome
          entry={selectedEntry}
          ledger={ledger}
          query={query}
          setQuery={setQuery}
          connectedAddress={wallet?.address}
          copy={copy}
          language={language}
          lastLedgerRefreshAt={lastLedgerRefreshAt}
          nextLedgerRefreshAt={nextLedgerRefreshAt}
        />
      )}

      {page === 'rules' && <PrizeRules copy={copy} />}

      {page === 'draw' && (
        <>
          <PageHeader
            eyebrow={copy.draw.eyebrow}
            title={copy.draw.title}
            copy={copy.draw.copy}
            icon={FileCode2}
          />
          <section className="page-grid contract-page">
            <DrawReveal
              runMode={drawRunMode}
              onRunModeChange={(nextMode) => {
                setDrawRunMode(nextMode)
                setDrawMessage('')
              }}
              winnerTickets={activeWinnerTickets}
              totalTickets={ledger.totalFinalTickets}
              ledger={ledger}
              walletIdentities={walletIdentities}
              copy={copy}
              drawStatus={activeDrawStatus}
              hasWallet={Boolean(wallet)}
              isContractBusy={drawBusy === 'draw' || drawBusy === 'drawNext'}
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
              onConnectWallet={() => connectBscWallet(activeDrawNetworkKey)}
              onRefreshStatus={() => refreshDrawStatus(activeDrawNetworkKey)}
              onRequestDraw={() => requestDrawRound(activeDrawNetworkKey)}
              onDrawNext={() => {
                void drawContractWinners(1, activeDrawNetworkKey)
              }}
              copy={copy}
            />
            <ContractDetails ledger={ledger} network={activeDrawNetwork} copy={copy} />
            <section className="draw-support-panel">
              <article className="draw-support-card draw-support-card--media">
                <img src={liveDrawImage} alt="Van Gogh live draw machine artwork" />
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
    </main>
  )
}
