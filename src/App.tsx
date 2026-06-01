import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileCode2, Loader2, ShieldCheck, Ticket } from 'lucide-react'
import './App.css'
import renaissLogo from './assets/renaiss-logo-alpha-cropped.png'
import liveDrawImage from './assets/van-gogh-live-source.jpeg'
import { ContractDetails } from './components/ContractDetails'
import { PrizeRules } from './components/PrizeRules'
import { TicketHome } from './components/TicketHome'
import { WalletPanel } from './components/WalletPanel'
import { COPY, LANGUAGES, type LanguageCode } from './lib/i18n'
import { loadRaffleLedger } from './lib/ticketing/openMonitor'
import { entryMatches } from './lib/ticketing/display'
import type { RaffleLedger } from './lib/ticketing/types'
import { connectInjectedWallet, type ConnectedWallet } from './lib/wallet/bsc'

type PageKey = 'tickets' | 'rules' | 'draw'

const LEDGER_REFRESH_INTERVAL_MS = 15 * 60 * 1000

const NAV_ITEMS: PageKey[] = ['tickets', 'rules', 'draw']

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
  const [contractAddress, setContractAddress] = useState<string>(
    import.meta.env.VITE_DRAW_CONTRACT || '',
  )
  const [language, setLanguage] = useState<LanguageCode>('zh-TW')
  const [lastLedgerRefreshAt, setLastLedgerRefreshAt] = useState<number>(0)
  const [nextLedgerRefreshAt, setNextLedgerRefreshAt] = useState<number>(0)
  const copy = COPY[language]

  useEffect(() => {
    let alive = true

    async function refreshLedger() {
      try {
        const value = await loadRaffleLedger()
        if (!alive) return
        setLedger(value)
        setContractAddress((current) => current || value.drawContractAddress || '')
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

  const selectedEntry = useMemo(() => {
    if (!ledger || !query.trim()) return null
    return ledger.entries.find((entry) => entryMatches(entry, query)) ?? null
  }, [ledger, query])

  async function connectBscWallet() {
    setWalletError('')
    try {
      setWallet(await connectInjectedWallet())
      setPage('draw')
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : copy.walletPanel.connectionFailed)
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
          <nav className="nav-links" aria-label="Lucky draw pages">
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
          <div className="nav-actions">
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
            <button className="nav-action" type="button" onClick={connectBscWallet}>
              {wallet ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : copy.common.connectWallet}
            </button>
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
            <WalletPanel
              contractAddress={contractAddress}
              setContractAddress={setContractAddress}
              wallet={wallet}
              setWallet={setWallet}
              copy={copy}
            />
            <ContractDetails ledger={ledger} copy={copy} />
            <section className="panel draw-visual-panel">
              <img src={liveDrawImage} alt="Van Gogh live draw machine artwork" />
              <div>
                <span className="eyebrow">{copy.draw.liveReady}</span>
                <h2>{copy.draw.liveTitle}</h2>
                <p className="soft-copy">
                  {copy.draw.liveCopy}
                </p>
              </div>
            </section>
            <section className="panel contract-notes">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">{copy.draw.securityEyebrow}</span>
                  <h2>{copy.draw.securityTitle}</h2>
                </div>
                <ShieldCheck size={22} />
              </div>
              <p>{copy.draw.securityCopy1}</p>
              <p>{copy.draw.securityCopy2}</p>
            </section>
          </section>
        </>
      )}
    </main>
  )
}
