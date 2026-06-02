import { Database, Loader2, LockKeyhole, Sparkles, Wallet } from 'lucide-react'
import type { DrawNetworkConfig } from '../lib/contracts/luckyDrawNetworks'
import type { AppCopy } from '../lib/i18n'
import { compactNumber } from '../lib/ticketing/display'
import { formatAddress } from '../lib/ticketing/rules'
import {
  type ConnectedWallet,
  type DrawStatus,
} from '../lib/wallet/bsc'

export function WalletPanel({
  network,
  wallet,
  status,
  message,
  busy,
  onConnectWallet,
  onRefreshStatus,
  onRequestDraw,
  onDrawNext,
  copy,
  ledgerTotalTickets,
  transactionHashes,
}: {
  network: DrawNetworkConfig
  wallet: ConnectedWallet | null
  status: DrawStatus | null
  message: string
  busy: 'connect' | 'read' | 'draw' | 'drawNext' | null
  onConnectWallet: () => void
  onRefreshStatus: () => void
  onRequestDraw: () => void
  onDrawNext: () => void
  copy: AppCopy
  ledgerTotalTickets: number
  transactionHashes: string[]
}) {
  const drawState = status
    ? status.fulfilled
      ? copy.walletPanel.fulfilled
      : status.requested
        ? copy.walletPanel.requested
        : copy.walletPanel.ready
      : wallet
      ? copy.common.pending
      : copy.walletPanel.disconnected
  const isWalletOnSelectedNetwork = wallet?.chainId === network.chainId
  const hasTicketMismatch = Boolean(status && status.totalTickets !== BigInt(ledgerTotalTickets))
  const explorerBaseUrl = network.blockExplorerUrls[0]?.replace(/\/$/, '') ?? ''
  const contractExplorerUrl = `${explorerBaseUrl}/address/${network.contractAddress}`
  const contractEventsUrl = `${contractExplorerUrl}#events`
  const chainActionsDisabled = busy !== null || !wallet || hasTicketMismatch

  return (
    <section className="panel wallet-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.walletPanel.bscLiveDraw}</span>
          <h2>{copy.walletPanel.title}</h2>
          <p>{copy.walletPanel.subtitle}</p>
        </div>
        <span className={`wallet-state-pill ${wallet ? 'is-connected' : ''}`}>
          <LockKeyhole size={15} />
          {wallet ? copy.walletPanel.connected : copy.walletPanel.disconnected}
        </span>
      </div>

      <div className="wallet-contract-card">
        <span>{network.label}</span>
        <strong>{network.contractAddress}</strong>
        <small>{network.chainName}</small>
      </div>

      <div className="wallet-actions-head">
        <span>{copy.walletPanel.operation}</span>
        <strong>{drawState}</strong>
      </div>

      <div className="button-row">
        <button className="primary shimmer-button" onClick={onConnectWallet} disabled={busy !== null}>
          {busy === 'connect' ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
          {wallet ? formatAddress(wallet.address) : copy.walletPanel.connectBsc}
        </button>
        <button onClick={onRefreshStatus} disabled={busy !== null || !wallet}>
          {busy === 'read' ? <Loader2 className="spin" size={18} /> : <Database size={18} />}
          {copy.walletPanel.read}
        </button>
        <button onClick={onRequestDraw} disabled={chainActionsDisabled || Boolean(status?.requested)}>
          {busy === 'draw' ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {copy.walletPanel.draw}
        </button>
        <button onClick={onDrawNext} disabled={chainActionsDisabled || !status?.requested || Boolean(status?.fulfilled)}>
          {busy === 'drawNext' ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {copy.walletPanel.drawNext}
        </button>
      </div>

      {wallet ? (
        <div className="mini-grid">
          <span>{copy.walletPanel.chain}</span>
          <strong className={isWalletOnSelectedNetwork ? '' : 'is-warning'}>{wallet.chainName}</strong>
          <span>{copy.walletPanel.operator}</span>
          <strong>{formatAddress(wallet.address)}</strong>
        </div>
      ) : (
        <p className="wallet-status-preview">{copy.walletPanel.statusPreview}</p>
      )}

      {status && (
        <div className="contract-status">
          <div>
            <span>{copy.walletPanel.ledger}</span>
            <strong>{status.ledgerHash.slice(0, 10)}...</strong>
          </div>
          <div>
            <span>{copy.walletPanel.totalTickets}</span>
            <strong>{compactNumber(status.totalTickets)}</strong>
          </div>
          <div>
            <span>{copy.walletPanel.ledgerTotalTickets}</span>
            <strong>{compactNumber(ledgerTotalTickets)}</strong>
          </div>
          <div>
            <span>{copy.walletPanel.drawState}</span>
            <strong>{drawState}</strong>
          </div>
          <div>
            <span>{copy.walletPanel.winners}</span>
            <strong>
              {status.winnerCount > 0n
                ? `${compactNumber(status.winnerCount)} / ${compactNumber(status.prizeSlotCount)}`
                : `0 / ${compactNumber(status.prizeSlotCount)}`}
            </strong>
          </div>
        </div>
      )}

      {hasTicketMismatch && (
        <p className="message wallet-warning-message">{copy.walletPanel.contractTotalMismatch}</p>
      )}

      {status?.winnerTickets.length ? (
        <div className="winner-strip">
          {status.winnerTickets.map((ticket) => (
            <span key={ticket.toString()}>#{compactNumber(ticket)}</span>
          ))}
        </div>
      ) : null}

      <div className="wallet-link-panel">
        <span>{copy.walletPanel.blockchainLinks}</span>
        <div>
          <a href={contractExplorerUrl} target="_blank" rel="noreferrer">
            {copy.walletPanel.contractExplorer}
          </a>
          <a href={contractEventsUrl} target="_blank" rel="noreferrer">
            {copy.walletPanel.eventLogs}
          </a>
          {transactionHashes.map((hash) => (
            <a href={`${explorerBaseUrl}/tx/${hash}`} target="_blank" rel="noreferrer" key={hash}>
              {hash.slice(0, 10)}...
            </a>
          ))}
        </div>
      </div>

      {message && <p className="message">{message}</p>}
    </section>
  )
}
